import type { ChainId, HandleRef, Money } from "../chains/types";

/** Every kind of thing that shows up in a user's activity feed. */
export type HistoryKind = "send" | "receive" | "claim" | "airtime" | "bill" | "swap" | "cashout";

/**
 * Where a thing ended up.
 *
 * `returned` is its own state rather than a kind of failure: money that waited
 * for someone who never joined and came back is not an error, and showing it as
 * one would make people think Selkie lost their payment. It is also not a second
 * event — one payment, one line in the feed, from "waiting" to "back with you".
 */
export type HistoryStatus = "pending" | "confirmed" | "failed" | "returned";

export interface HistoryEntry {
  id: string;
  kind: HistoryKind;
  chain: ChainId;
  amount: Money;
  /** The other side: a handle, a biller, a phone number. Display-safe string. */
  counterparty?: string;
  /**
   * The other side as a handle, when it was one.
   *
   * `counterparty` alone is not enough to pay someone again: it reads "@amaka"
   * with no platform, and @amaka on X is a different person from @amaka on
   * Telegram. Anything that turns history back into a payment needs this.
   */
  counterpartyHandle?: HandleRef;
  status: HistoryStatus;
  /** ISO timestamp. */
  at: string;
  /** Chain-native reference, when settled. */
  ref?: string;
  /**
   * The escrow's own id for money still waiting on a handle.
   *
   * Distinct from `ref`, which is the transaction that put it there. Taking a
   * payment back needs the id of the payment, not the id of the transaction, so
   * an entry without this can never be refunded.
   */
  claimRef?: string;
  /**
   * When unclaimed money can be taken back, as an ISO timestamp.
   *
   * The contract refuses a refund before this, so the UI reads it from here
   * rather than offering a button that is going to fail.
   */
  refundableAt?: string;
}
