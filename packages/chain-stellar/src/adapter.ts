import { Asset, Operation } from "@stellar/stellar-sdk";
import type {
  Account,
  Balance,
  ChainAdapter,
  ChainCapabilities,
  HandleRef,
  Money,
  PaymentResult,
  TxResult,
} from "@selkie/core";
import { assertPositive, fromStroops, toStellarAmount } from "./amounts";
import { AssetRegistry } from "./assets";
import type { StellarConfig } from "./config";
import type { AccountDirectory } from "./directory";
import { EscrowClient, type EscrowPayment } from "./escrow";
import { StellarNetwork, isNotFound } from "./network";
import { addSponsoredTrustline, hasTrustline, provisionAccount } from "./provisioning";
import type { Signer, SignerProvider } from "./signer";

/**
 * Stellar implementation of ChainAdapter. This is the ONLY place Stellar
 * specific code lives; the rest of Selkie never imports a Stellar SDK.
 *
 * The two flows that matter:
 *
 *  - Paying someone who has an account: a direct USDC payment, fee-bumped by the
 *    sponsor so neither side needs XLM.
 *  - Paying a handle with no account: funds go into the handle-escrow contract,
 *    addressed to sha256("x:amaka"). Nobody holds them, not even Selkie. When
 *    that person signs in, the oracle releases them into their new wallet.
 *
 * Everything the adapter needs from the outside (who owns which address, how to
 * sign, which assets are allowed) arrives as an interface, so this class works
 * the same in a test, in the API server, and in the bot.
 */
export interface StellarAdapterDeps {
  config: StellarConfig;
  directory: AccountDirectory;
  signers: SignerProvider;
  /** Pays fees and reserves. This is what "no gas" means in practice. */
  sponsor: Signer;
  /** Attests logins to the escrow contract. Its only power is releasing a claim. */
  oracle: Signer;
  /** Creates a fresh keypair for a new user. Swap for Privy or passkeys later. */
  createSigner: () => Promise<Signer>;
}

export class StellarAdapter implements ChainAdapter {
  readonly id = "stellar" as const;
  readonly capabilities: ChainCapabilities = {
    claimableSends: true,
    gasless: true,
    ramp: false, // ramps are deliberately out of the MVP
  };

  readonly network: StellarNetwork;
  readonly assets: AssetRegistry;
  readonly escrow: EscrowClient;

  constructor(private readonly deps: StellarAdapterDeps) {
    this.network = new StellarNetwork(deps.config);
    this.assets = new AssetRegistry(deps.config.assets);
    this.escrow = new EscrowClient(this.network, deps.config.escrowContractId);
  }

  /**
   * Find or create the account a handle owns.
   *
   * The on-chain account is created lazily: a user gets an address the moment
   * they sign up, but the ledger entry (and the reserves Selkie pays for) only
   * appears when money is actually about to touch it. Half of all sign-ups
   * anywhere never transact, and sponsoring reserves for them is real money.
   */
  async ensureAccount(handle: HandleRef): Promise<Account> {
    const existing = await this.deps.directory.lookup(handle);
    if (existing) {
      return {
        chain: this.id,
        handle,
        address: existing.address,
        status: existing.provisioned ? "active" : "provisioning",
      };
    }

    const signer = await this.deps.createSigner();
    await this.deps.directory.save({ handle, address: signer.address, provisioned: false });
    return { chain: this.id, handle, address: signer.address, status: "provisioning" };
  }

  /** Create the ledger entry and trustlines, paid for by the sponsor. */
  async provision(handle: HandleRef): Promise<Account> {
    const account = await this.ensureAccount(handle);
    if (account.status === "active") return account;

    const signer = await this.deps.signers.forAddress(account.address);
    if (!signer) throw new Error(`No signer available for ${account.address}`);

    if (!(await this.network.accountExists(account.address))) {
      await provisionAccount({
        network: this.network,
        assets: this.assets,
        sponsor: this.deps.sponsor,
        account: signer,
        trustlines: this.assets
          .list()
          .filter((asset) => asset.issuer)
          .map((asset) => asset.code),
      });
    }

    await this.deps.directory.save({ handle, address: account.address, provisioned: true });
    return { ...account, status: "active" };
  }

  /**
   * Make an address able to receive money from outside Selkie.
   *
   * This is what "here is your address, send money to it" actually requires on
   * Stellar. An address with no ledger entry cannot be paid at all, and an
   * account with no trustline for USDC will bounce a USDC payment back to the
   * sender. Both failures happen at the sender's end, silently, after the money
   * has left, which is the worst possible place to discover them.
   *
   * So the Receive screen calls this before it shows anyone an address. It is
   * the one moment where the lazy account creation has to stop being lazy.
   */
  async ensureReceivable(address: string): Promise<{ address: string; accepts: string[] }> {
    const signer = await this.deps.signers.forAddress(address);
    if (!signer) throw new Error(`No signer available for ${address}`);

    const issued = this.assets
      .list()
      .filter((asset) => asset.issuer)
      .map((asset) => asset.code);

    if (!(await this.network.accountExists(address))) {
      await provisionAccount({
        network: this.network,
        assets: this.assets,
        sponsor: this.deps.sponsor,
        account: signer,
        trustlines: issued,
      });
    } else {
      // The account is here but may predate an asset we added later.
      for (const code of issued) {
        const def = this.assets.get(code);
        if (await hasTrustline(this.network, address, def.code, def.issuer)) continue;
        await addSponsoredTrustline({
          network: this.network,
          assets: this.assets,
          sponsor: this.deps.sponsor,
          account: signer,
          code,
        });
      }
    }

    // The directory tracks whether a wallet is real yet, and it is now.
    const record = await this.deps.directory.lookupByAddress(address);
    if (record && !record.provisioned) {
      await this.deps.directory.save({ ...record, provisioned: true });
    }

    return { address, accepts: this.assets.list().map((asset) => asset.code) };
  }

  async getBalance(account: Account): Promise<Balance> {
    const balances: Money[] = [];
    try {
      const loaded = await this.network.loadAccount(account.address);
      for (const entry of loaded.balances) {
        const asset =
          entry.asset_type === "native"
            ? Asset.native()
            : "asset_code" in entry && "asset_issuer" in entry
              ? new Asset(entry.asset_code, entry.asset_issuer)
              : null;
        if (!asset) continue;

        // Unlisted assets are ignored on purpose: anyone can send junk to a
        // public address, and Selkie showing it would imply we vouch for it.
        const def = this.assets.fromStellarAsset(asset);
        if (!def) continue;
        // Horizon pads to 7 decimals ("25.0000000"). Normalize here so every
        // surface gets "25" and nobody formats money differently.
        balances.push({ amount: toStellarAmount(entry.balance), asset: def.code });
      }
    } catch (error) {
      if (!isNotFound(error)) throw error;
      // No ledger entry yet. A brand-new user has a wallet with nothing in it,
      // which is a zero balance, not an error.
    }

    for (const def of this.assets.list()) {
      if (!balances.some((money) => money.asset === def.code)) {
        balances.push({ amount: "0", asset: def.code });
      }
    }
    return { account, balances };
  }

  /**
   * Send money from one handle to another, taking the direct path when the
   * recipient can receive it and the escrow path when they cannot. Callers never
   * need to know which ran; the result says so via `heldForClaim`.
   */
  async send(from: HandleRef, to: HandleRef, amount: Money, memo?: string): Promise<PaymentResult> {
    assertPositive(amount.amount);
    const asset = this.assets.get(amount.asset);

    const sender = await this.provision(from);
    const senderSigner = await this.deps.signers.forAddress(sender.address);
    if (!senderSigner) throw new Error(`No signer available for ${sender.address}`);

    const recipient = await this.deps.directory.lookup(to);
    const recipientReady =
      recipient?.provisioned && (await this.network.accountExists(recipient.address));

    if (recipientReady && recipient) {
      const response = await this.network.submit({
        source: sender.address,
        operations: [
          Operation.payment({
            destination: recipient.address,
            asset: this.assets.toStellarAsset(asset.code),
            amount: toStellarAmount(amount.amount),
          }),
        ],
        signers: [senderSigner],
        sponsor: this.deps.sponsor,
        memo,
      });
      return { status: "confirmed", ref: response.hash, heldForClaim: false };
    }

    // Nobody is home yet, so the money waits in the contract for whoever proves
    // they own the handle. This is the whole product in one branch.
    const { paymentId, hash } = await this.escrow.deposit({
      sender: senderSigner,
      tokenContractId: this.contractIdFor(asset.code),
      amount: assertPositive(amount.amount),
      handle: to,
      lifetimeSeconds: this.deps.config.claimLifetimeSeconds,
      sponsor: this.deps.sponsor,
    });

    return {
      status: "confirmed",
      ref: hash,
      heldForClaim: true,
      claimRef: paymentId.toString(),
    };
  }

  /**
   * Release everything waiting for a handle. Called after the login that proves
   * the handle belongs to this person, never before.
   */
  async claim(handle: HandleRef): Promise<TxResult> {
    const account = await this.provision(handle);
    const pending = await this.escrow.pending(handle, this.deps.oracle.address);
    if (pending.length === 0) {
      return { status: "confirmed", ref: undefined };
    }

    const { hash } = await this.escrow.claimHandle({
      oracle: this.deps.oracle,
      handle,
      recipient: account.address,
    });
    return { status: "confirmed", ref: hash };
  }

  /** How much is waiting for a handle that has not signed in yet. */
  async pendingClaims(handle: HandleRef): Promise<bigint[]> {
    return this.escrow.pending(handle, this.deps.oracle.address);
  }

  /** How long money waits for a handle before its sender can take it back. */
  get claimLifetimeSeconds(): number {
    return this.deps.config.claimLifetimeSeconds;
  }

  /**
   * Take back money that waited for someone who never came.
   *
   * The contract enforces both rules that matter: only the original sender can
   * do this, and only once the wait is over. Selkie checks them too so the
   * answer is a sentence rather than a contract error code, but the contract is
   * what makes them true.
   */
  async refund(paymentId: bigint, senderAddress: string): Promise<TxResult> {
    const signer = await this.deps.signers.forAddress(senderAddress);
    if (!signer) throw new Error(`No signer available for ${senderAddress}`);

    const { hash } = await this.escrow.refund({ sender: signer, paymentId });
    return { status: "confirmed", ref: hash };
  }

  /**
   * One waiting payment, or null once it is gone.
   *
   * Gone means claimed or already returned; the contract deletes the record
   * either way, so "not found" is the normal end of a payment's life and not an
   * error worth surfacing.
   */
  async waitingPayment(paymentId: bigint): Promise<EscrowPayment | null> {
    return this.escrow.getPayment(paymentId, this.deps.oracle.address);
  }

  /**
   * What is waiting for a handle, as money rather than a count of payments.
   *
   * "You have 3 payments waiting" is a worse sentence than "$25 was waiting for
   * you", and the second one is the reason anybody links their X account. Read
   * before claiming, because claiming deletes the records that hold the amounts.
   */
  async waitingFor(handle: HandleRef): Promise<Money[]> {
    const ids = await this.escrow.pending(handle, this.deps.oracle.address);
    const totals = new Map<string, bigint>();

    for (const id of ids) {
      const payment = await this.escrow.getPayment(id, this.deps.oracle.address);
      if (!payment) continue;
      const code = this.codeForContract(payment.token);
      // An asset we do not list is one we will not name. It is still claimable,
      // it just does not get a line in the UI.
      if (!code) continue;
      totals.set(code, (totals.get(code) ?? 0n) + payment.amount);
    }

    return [...totals].map(([asset, stroops]) => ({ amount: fromStroops(stroops), asset }));
  }

  /** Reverse of contractIdFor: which listed asset a contract address stands for. */
  codeForContract(contractId: string): string | null {
    for (const def of this.assets.list()) {
      if (this.contractIdFor(def.code) === contractId) return def.code;
    }
    return null;
  }

  /**
   * Move funds directly between two addresses Selkie can sign for.
   *
   * This is deliberately not part of ChainAdapter: the product sends to handles,
   * not addresses. It exists for account maintenance, above all merging two
   * accounts that turn out to be the same person, where the money has to follow
   * the identity.
   */
  async transfer(params: {
    fromAddress: string;
    toAddress: string;
    amount: Money;
  }): Promise<TxResult> {
    assertPositive(params.amount.amount);
    const asset = this.assets.get(params.amount.asset);

    const signer = await this.deps.signers.forAddress(params.fromAddress);
    if (!signer) throw new Error(`No signer available for ${params.fromAddress}`);

    const response = await this.network.submit({
      source: params.fromAddress,
      operations: [
        Operation.payment({
          destination: params.toAddress,
          asset: this.assets.toStellarAsset(asset.code),
          amount: toStellarAmount(params.amount.amount),
        }),
      ],
      signers: [signer],
      sponsor: this.deps.sponsor,
    });
    return { status: "confirmed", ref: response.hash };
  }

  /**
   * The contract address of a classic asset. Every Stellar asset has a
   * contract counterpart, which is what lets the escrow hold USDC itself
   * rather than a wrapped stand-in.
   */
  contractIdFor(code: string): string {
    return this.assets
      .toStellarAsset(code)
      .contractId(this.deps.config.networkPassphrase);
  }

  /** Human-readable balance of one asset, for the places that only need one number. */
  async balanceOf(account: Account, code: string): Promise<Money> {
    const balance = await this.getBalance(account);
    const found = balance.balances.find((money) => money.asset === code.toUpperCase());
    return found ?? { amount: fromStroops(0n), asset: code.toUpperCase() };
  }
}
