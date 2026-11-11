import { Address, Contract, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { HandleRef } from "@selkie/core";
import { handleHash } from "@selkie/core";
import type { StellarNetwork } from "./network";
import type { Signer } from "./signer";

/**
 * Client for the handle-escrow contract: the piece that lets Selkie pay someone
 * who has no wallet.
 *
 * The contract only ever sees sha256("<platform>:<username>"), produced by
 * handleHash() in @selkie/core. Both sides must agree byte for byte, or money
 * deposited for a handle can never be found again, so the hash is computed in
 * exactly one place and imported here.
 */
export interface EscrowPayment {
  id: bigint;
  sender: string;
  token: string;
  amount: bigint;
  expiry: bigint;
}

/** Error codes the contract returns, mapped to messages a person can act on. */
export const ESCROW_ERRORS: Record<number, string> = {
  1: "That amount is not valid.",
  2: "That payment would wait too long before it could be returned.",
  3: "This payment is no longer available. It was already claimed or returned.",
  4: "This payment cannot be returned yet. It is still waiting to be claimed.",
};

export class EscrowClient {
  readonly #contract: Contract;

  constructor(
    private readonly network: StellarNetwork,
    contractId: string,
  ) {
    this.#contract = new Contract(contractId);
  }

  get contractId(): string {
    return this.#contract.contractId();
  }

  /** Lock funds for a handle that may not have an account yet. */
  async deposit(params: {
    sender: Signer;
    tokenContractId: string;
    amount: bigint;
    handle: HandleRef;
    lifetimeSeconds: number;
    /** Pays the fee, so a sender with zero XLM can still pay a stranger. */
    sponsor?: Signer;
  }): Promise<{ paymentId: bigint; hash: string }> {
    const hash = await handleHash(params.handle);
    const operation = this.#contract.call(
      "deposit",
      Address.fromString(params.sender.address).toScVal(),
      Address.fromString(params.tokenContractId).toScVal(),
      nativeToScVal(params.amount, { type: "i128" }),
      xdr.ScVal.scvBytes(Buffer.from(hash)),
      nativeToScVal(BigInt(params.lifetimeSeconds), { type: "u64" }),
    );

    const { result, hash: txHash } = await this.network.invokeContract<bigint>({
      source: params.sender.address,
      signer: params.sender,
      operation,
      sponsor: params.sponsor,
    });
    return { paymentId: result, hash: txHash };
  }

  /**
   * Release everything waiting for a handle to a recipient address. Only the
   * oracle can authorize this, and only after the handle's owner proved
   * ownership by signing in.
   */
  async claimHandle(params: {
    oracle: Signer;
    handle: HandleRef;
    recipient: string;
  }): Promise<{ released: number; hash: string }> {
    const hash = await handleHash(params.handle);
    const operation = this.#contract.call(
      "claim_handle",
      xdr.ScVal.scvBytes(Buffer.from(hash)),
      Address.fromString(params.recipient).toScVal(),
    );

    const { result, hash: txHash } = await this.network.invokeContract<number>({
      source: params.oracle.address,
      signer: params.oracle,
      operation,
    });
    return { released: Number(result), hash: txHash };
  }

  /** Release a single payment. Used when a handle has more waiting than one batch can carry. */
  async claim(params: {
    oracle: Signer;
    paymentId: bigint;
    recipient: string;
  }): Promise<{ hash: string }> {
    const operation = this.#contract.call(
      "claim",
      nativeToScVal(params.paymentId, { type: "u64" }),
      Address.fromString(params.recipient).toScVal(),
    );
    const { hash } = await this.network.invokeContract({
      source: params.oracle.address,
      signer: params.oracle,
      operation,
    });
    return { hash };
  }

  /** Return an expired, unclaimed payment to whoever sent it. */
  async refund(params: { sender: Signer; paymentId: bigint }): Promise<{ hash: string }> {
    const operation = this.#contract.call(
      "refund",
      nativeToScVal(params.paymentId, { type: "u64" }),
    );
    const { hash } = await this.network.invokeContract({
      source: params.sender.address,
      signer: params.sender,
      operation,
    });
    return { hash };
  }

  /** Payment ids still waiting for a handle. A read, so it costs nothing. */
  async pending(handle: HandleRef, readerAddress: string): Promise<bigint[]> {
    const hash = await handleHash(handle);
    const operation = this.#contract.call("pending", xdr.ScVal.scvBytes(Buffer.from(hash)));
    const result = await this.network.readContract<bigint[]>({
      source: readerAddress,
      operation,
    });
    return result ?? [];
  }

  async getPayment(paymentId: bigint, readerAddress: string): Promise<EscrowPayment | null> {
    const operation = this.#contract.call(
      "get_payment",
      nativeToScVal(paymentId, { type: "u64" }),
    );
    const result = await this.network.readContract<Record<string, unknown> | null>({
      source: readerAddress,
      operation,
    });
    if (!result) return null;
    return {
      id: paymentId,
      sender: String(result["sender"]),
      token: String(result["token"]),
      amount: BigInt(String(result["amount"])),
      expiry: BigInt(String(result["expiry"])),
    };
  }
}
