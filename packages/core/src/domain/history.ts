import type { ChainId, Money } from "../chains/types";

/** Every kind of thing that shows up in a user's activity feed. */
export type HistoryKind = "send" | "receive" | "claim" | "airtime" | "bill" | "swap" | "cashout";

export interface HistoryEntry {
  id: string;
  kind: HistoryKind;
  chain: ChainId;
  amount: Money;
  /** The other side: a handle, a biller, a phone number. Display-safe string. */
  counterparty?: string;
  status: "pending" | "confirmed" | "failed";
  /** ISO timestamp. */
  at: string;
  /** Chain-native reference, when settled. */
  ref?: string;
}
