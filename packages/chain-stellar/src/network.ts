import {
  BASE_FEE,
  Horizon,
  Memo,
  Operation,
  Transaction,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { Signer } from "./signer";

export class StellarNetworkError extends Error {}

/** Enough fee headroom that a busy ledger does not strand a user's payment. */
const FEE_MULTIPLIER = 10n;
const TX_TIMEOUT_SECONDS = 60;

export interface NetworkOptions {
  horizonUrl: string;
  rpcUrl: string;
  networkPassphrase: string;
}

/**
 * The plumbing: Horizon for classic operations and path finding, Soroban RPC for
 * contract calls, and one place that knows how to get a transaction signed,
 * sponsored, and confirmed.
 *
 * Fee bumping lives here because it is what makes Selkie gasless. A user's
 * transaction is built and signed by the user, then wrapped in a fee-bump paid
 * by the sponsor, so the user never needs to hold XLM to move their dollars.
 */
export class StellarNetwork {
  readonly horizon: Horizon.Server;
  readonly rpc: rpc.Server;
  readonly networkPassphrase: string;

  constructor(options: NetworkOptions) {
    this.horizon = new Horizon.Server(options.horizonUrl);
    this.rpc = new rpc.Server(options.rpcUrl);
    this.networkPassphrase = options.networkPassphrase;
  }

  get feePerOperation(): string {
    return (BigInt(BASE_FEE) * FEE_MULTIPLIER).toString();
  }

  async accountExists(address: string): Promise<boolean> {
    try {
      await this.horizon.loadAccount(address);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async loadAccount(address: string): Promise<Horizon.AccountResponse> {
    return this.horizon.loadAccount(address);
  }

  /**
   * Build, sign, and submit a classic transaction.
   *
   * When `sponsor` is given the transaction is fee-bumped: the sponsor pays the
   * network fee and the user pays nothing. When it is not, the source pays for
   * itself (used by the sponsor's own transactions).
   */
  async submit(params: {
    source: string;
    operations: xdr.Operation[];
    signers: Signer[];
    sponsor?: Signer;
    memo?: string;
  }): Promise<Horizon.HorizonApi.SubmitTransactionResponse> {
    const account = await this.loadAccount(params.source);
    const builder = new TransactionBuilder(account, {
      fee: this.feePerOperation,
      networkPassphrase: this.networkPassphrase,
    });
    for (const operation of params.operations) builder.addOperation(operation);
    if (params.memo) builder.addMemo(memoText(params.memo));

    const tx = builder.setTimeout(TX_TIMEOUT_SECONDS).build();
    for (const signer of params.signers) await signer.sign(tx);

    if (!params.sponsor) {
      return this.horizon.submitTransaction(tx);
    }
    return this.horizon.submitTransaction(await this.feeBump(tx, params.sponsor));
  }

  /**
   * Wrap a signed transaction so the sponsor pays its fee. This is the whole
   * mechanism behind "no gas": the network still charges, Selkie just pays.
   */
  async feeBump(tx: Transaction, sponsor: Signer) {
    // The bump must cover the inner fee, which for a contract call already
    // includes the resource fee that simulation worked out.
    const innerFee = BigInt(tx.fee);
    const perOperation = BigInt(this.feePerOperation);
    const outerFee = (innerFee + perOperation) * BigInt(tx.operations.length + 1);

    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      sponsor.address,
      outerFee.toString(),
      tx,
      this.networkPassphrase,
    );
    await sponsor.sign(feeBump);
    return feeBump;
  }

  /**
   * Invoke a contract method: simulate, assemble the resource footprint, sign,
   * submit, and wait for the ledger to confirm.
   */
  async invokeContract<T = unknown>(params: {
    source: string;
    signer: Signer;
    operation: xdr.Operation;
    /**
     * Pays the fee so the caller does not need XLM. Contract calls need this as
     * much as classic payments do: the escrow path is the one flow a brand-new
     * user hits first, and it would not be gasless without it.
     */
    sponsor?: Signer;
  }): Promise<{ result: T; hash: string }> {
    const account = await this.rpc.getAccount(params.source);
    const tx = new TransactionBuilder(account, {
      fee: this.feePerOperation,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(params.operation)
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();

    const simulation = await this.rpc.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new StellarNetworkError(`Simulation failed: ${simulation.error}`);
    }

    const prepared = rpc.assembleTransaction(tx, simulation).build();
    await params.signer.sign(prepared);

    // A fee bump wraps the signed inner transaction, so the sponsor pays the
    // resource fee the simulation just calculated.
    const submitted = params.sponsor
      ? await this.feeBump(prepared, params.sponsor)
      : prepared;

    const sent = await this.rpc.sendTransaction(submitted);
    if (sent.status === "ERROR") {
      throw new StellarNetworkError(`Submission rejected: ${JSON.stringify(sent.errorResult)}`);
    }

    const confirmed = await this.rpc.pollTransaction(sent.hash, {
      attempts: 30,
      sleepStrategy: () => 1000,
    });

    if (confirmed.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new StellarNetworkError(`Transaction ${sent.hash} did not succeed: ${confirmed.status}`);
    }

    const result = (
      confirmed.returnValue ? scValToNative(confirmed.returnValue) : undefined
    ) as T;
    return { result, hash: sent.hash };
  }

  /** Read a contract value without submitting anything. */
  async readContract<T = unknown>(params: {
    source: string;
    operation: xdr.Operation;
  }): Promise<T> {
    const account = await this.rpc.getAccount(params.source);
    const tx = new TransactionBuilder(account, {
      fee: this.feePerOperation,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(params.operation)
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();

    const simulation = await this.rpc.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new StellarNetworkError(`Simulation failed: ${simulation.error}`);
    }
    const retval = (simulation as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    return (retval ? scValToNative(retval) : undefined) as T;
  }
}

/** Stellar memos are 28 bytes. Trim rather than fail a payment over a label. */
function memoText(text: string): Memo {
  const encoder = new TextEncoder();
  let value = text;
  while (encoder.encode(value).length > 28) value = value.slice(0, -1);
  return Memo.text(value);
}

export function isNotFound(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 404 || (error as { name?: string })?.name === "NotFoundError";
}

export { Operation, Transaction };
