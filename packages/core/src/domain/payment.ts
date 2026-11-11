import type { ChainAdapter } from "../chains/adapter";
import type { HandleRef, Money, PaymentResult } from "../chains/types";

/**
 * The high-level, chain-agnostic payment flow. Surfaces (web, bot) call this and
 * never touch a chain adapter's low-level methods directly. Swap the adapter and
 * the same flow runs on a different chain.
 */
export class PaymentService {
  constructor(private readonly chain: ChainAdapter) {}

  /** Pay a handle. The sender is provisioned if needed; the recipient need not exist. */
  async pay(from: HandleRef, to: HandleRef, amount: Money, memo?: string): Promise<PaymentResult> {
    await this.chain.ensureAccount(from);
    return this.chain.send(from, to, amount, memo);
  }
}
