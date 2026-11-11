/**
 * Everything the backend does on NEAR, behind one object.
 *
 * Three keys, three narrow jobs, each its own Account so a bug in one path can
 * never borrow another's authority:
 *
 *  - creator (`x.selkiepay`): CreateAccount for a new handle account, adding the
 *    USER's key as its only key. Never adds a key of ours.
 *  - relayer: pays gas for delegate actions users signed, and storage deposits.
 *  - oracle: a function-call key that can call `escrow.claim` and nothing else.
 *
 * None of them can move money that already sits in a user's account.
 */
import { Account, JsonRpcProvider, KeyPair, PublicKey, actions, type SignedDelegate } from "near-api-js";
import type { NearServerConfig } from "./config";
import type { PreparedDelegate } from "./delegate";
import { listAccessKeys, type AccessKeySummary } from "./keys";
import { GAS, escrowEvents, firstFailure, type Call, type EscrowEvent, type OutcomeLike, type PaymentView } from "./escrow";

export interface TxOutcome {
  txHash: string;
  events: EscrowEvent[];
  /** Set when a receipt inside the transaction failed. */
  failure: string | null;
}

/**
 * What sits at an account name. A contract matters to someone paying it: most
 * contracts have no way to send a token back out, so USDC paid to one (a
 * staking pool, a DAO, a game) can be stuck there for good.
 */
export type AccountKind = "missing" | "wallet" | "contract";

/** base58 of 32 zero bytes: the code hash NEAR reports for an account with no contract. */
const NO_CONTRACT = "11111111111111111111111111111111";

/**
 * True when the account runs code: its own contract, or a global contract it
 * points at (those report the empty code hash, so the hash alone misses them).
 */
export function hasContract(view: {
  code_hash: string;
  global_contract_hash?: string | null;
  global_contract_account_id?: string | null;
}): boolean {
  return view.code_hash !== NO_CONTRACT || Boolean(view.global_contract_hash) || Boolean(view.global_contract_account_id);
}

/** How long a prepared action stays signable, in blocks (~1 s each). */
const PREPARE_TTL_BLOCKS = 300n;

export class NearChain {
  readonly provider: JsonRpcProvider;
  readonly #creator: Account;
  readonly #relayer: Account;
  readonly #oracle: Account;

  constructor(readonly config: NearServerConfig) {
    this.provider = new JsonRpcProvider({ url: config.rpcUrl });
    this.#creator = new Account(config.handleParent, this.provider, config.handleParentKey);
    this.#relayer = new Account(config.relayerAccount, this.provider, config.relayerKey);
    this.#oracle = new Account(config.oracleAccount, this.provider, config.oracleKey);
  }

  /**
   * The public halves of every key Selkie holds. A handle account showing any of
   * these would break the promise on the balance card, so the proof screen and
   * `prove:keys` check against this list rather than against a hope.
   */
  selkieKeys(): string[] {
    return [this.config.handleParentKey, this.config.relayerKey, this.config.oracleKey].map((secret) =>
      KeyPair.fromString(secret).getPublicKey().toString(),
    );
  }

  // ---- reads ---------------------------------------------------------------

  async accountExists(accountId: string): Promise<boolean> {
    return (await this.accountKind(accountId)) !== "missing";
  }

  /** Whether a name is free, a wallet somebody holds keys to, or a contract. */
  async accountKind(accountId: string): Promise<AccountKind> {
    try {
      const view = await this.provider.viewAccount({ accountId, blockQuery: { finality: "final" } });
      return hasContract(view) ? "contract" : "wallet";
    } catch (error) {
      if (isMissingAccount(error)) return "missing";
      throw error;
    }
  }

  async listKeys(accountId: string): Promise<AccessKeySummary[]> {
    return listAccessKeys(this.provider, accountId);
  }

  async usdcBalance(accountId: string): Promise<bigint> {
    const balance = await this.view<string>(this.config.usdcContract, "ft_balance_of", { account_id: accountId });
    return BigInt(balance ?? "0");
  }

  /** NEP-145: an account must be registered on the token before it can hold any. */
  async isUsdcRegistered(accountId: string): Promise<boolean> {
    const storage = await this.view<unknown>(this.config.usdcContract, "storage_balance_of", { account_id: accountId });
    return storage !== null && storage !== undefined;
  }

  async pending(recipient: string): Promise<PaymentView[]> {
    return (await this.view<PaymentView[]>(this.config.escrowContract, "pending", { recipient })) ?? [];
  }

  async getPayment(id: string): Promise<PaymentView | null> {
    return (await this.view<PaymentView | null>(this.config.escrowContract, "get_payment", { id })) ?? null;
  }

  /**
   * Turn a call into something a user can sign: their key's next nonce and a
   * block height after which the signature is void.
   */
  async prepare(senderId: string, publicKey: string, call: Call): Promise<PreparedDelegate> {
    const [key, block] = await Promise.all([
      this.provider.viewAccessKey({ accountId: senderId, publicKey, finalityQuery: { finality: "final" } }),
      this.provider.viewBlock({ finality: "final" }),
    ]);
    return {
      senderId,
      receiverId: call.receiverId,
      calls: call.calls,
      publicKey,
      nonce: (BigInt(key.nonce) + 1n).toString(),
      maxBlockHeight: (BigInt(block.header.height) + PREPARE_TTL_BLOCKS).toString(),
    };
  }

  // ---- writes --------------------------------------------------------------

  /**
   * Create `accountId` under the handle parent with `publicKey` as its only key.
   *
   * Full access, and the user's: that is the point. Selkie can verify this with
   * `listKeys` afterwards and so can anyone with an explorer.
   */
  async createHandleAccount(accountId: string, publicKey: string): Promise<string> {
    if (!accountId.endsWith(`.${this.config.handleParent}`)) {
      throw new Error(`${accountId} is not under ${this.config.handleParent}`);
    }
    const result = await this.#creator.signAndSendTransaction({
      receiverId: accountId,
      actions: [
        actions.createAccount(),
        actions.transfer(this.config.newAccountDeposit),
        actions.addFullAccessKey(PublicKey.fromString(publicKey)),
      ],
    });
    return result.transaction.hash;
  }

  /** Register an account on USDC so it can receive. Paid by the relayer; idempotent. */
  async registerForUsdc(accountId: string): Promise<string | null> {
    if (await this.isUsdcRegistered(accountId)) return null;
    const bounds = await this.view<{ min: string }>(this.config.usdcContract, "storage_balance_bounds", {});
    const result = await this.#relayer.callFunctionRaw({
      contractId: this.config.usdcContract,
      methodName: "storage_deposit",
      args: { account_id: accountId, registration_only: true },
      deposit: BigInt(bounds?.min ?? "1250000000000000000000"),
      gas: GAS.storageDeposit,
    });
    return result.transaction.hash;
  }

  /** Oracle: release everything waiting under `recipient` to `accountId`. */
  async claim(recipient: string, accountId: string): Promise<TxOutcome> {
    const result = await this.#oracle.callFunctionRaw({
      contractId: this.config.escrowContract,
      methodName: "claim",
      args: { recipient, account_id: accountId },
      gas: GAS.claim,
    });
    return this.#outcome(result);
  }

  /** Relayer: submit a delegate action the user signed. Verify it first (relayer.ts). */
  async relay(signed: SignedDelegate): Promise<TxOutcome> {
    const result = await this.#relayer.signAndSendTransaction({
      receiverId: signed.delegateAction.senderId,
      actions: [actions.signedDelegate(signed)],
      // A failed inner receipt is reported, not thrown: the caller needs the
      // hash either way, to show it and to record what happened.
      throwOnFailure: false,
    });
    return this.#outcome(result);
  }

  txUrl(hash: string): string {
    return `${this.config.explorerUrl}/transactions/${hash}`;
  }

  accountUrl(accountId: string): string {
    return `${this.config.explorerUrl}/accounts/${accountId}`;
  }

  #outcome(result: { transaction: { hash: string } } & OutcomeLike): TxOutcome {
    return {
      txHash: result.transaction.hash,
      events: escrowEvents(result, this.config.escrowContract),
      failure: firstFailure(result),
    };
  }

  async view<T>(contractId: string, method: string, args: Record<string, unknown>): Promise<T | undefined> {
    return (await this.provider.callFunction({ contractId, method, args })) as T | undefined;
  }
}

function isMissingAccount(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist/i.test(text);
}
