"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/contexts/ToastContext";
import type { ActivityEntry } from "@/lib/api";
import { money } from "@/lib/format";
import { useAmountsHidden } from "@/lib/privacy";

const INCOMING = new Set(["receive", "claim"]);
/** Long enough to read on a phone held at arm's length; this one matters more than "Copied". */
const SHOW_MS = 6_500;

/**
 * Say so when money comes in.
 *
 * The wallet already refreshes itself, so a new payment does appear on its own.
 * But a balance that quietly goes from 20 to 22 is easy to miss, and "someone
 * just paid you" is the best news this app ever gets to give. So every entry
 * that is new since the last look, and is money in, gets a toast naming who
 * sent it.
 *
 * The first load only sets what counts as already seen. Everything in the feed
 * when the page opened is old news, and the sign-in celebration covers money
 * that was waiting.
 */
export function useArrivals(entries: ActivityEntry[], loaded: boolean): void {
  const toast = useToast();
  const hidden = useAmountsHidden();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!loaded) return;
    if (!seen.current) {
      seen.current = new Set(entries.map((entry) => entry.id));
      return;
    }
    const known = seen.current;
    const fresh = entries.filter((entry) => !known.has(entry.id));
    for (const entry of fresh) known.add(entry.id);

    const arrived = fresh.filter((entry) => INCOMING.has(entry.kind) && entry.status !== "failed");
    if (arrived.length === 0) return;
    toast(
      "success",
      arrived.length === 1 ? arrivalLine(arrived[0]!, hidden) : `${arrived.length} payments just came in.`,
      { ms: SHOW_MS },
    );
  }, [entries, loaded, hidden, toast]);
}

/** "@tunde sent you 2.00 USDC." With amounts hidden, the news without the number. */
export function arrivalLine(entry: ActivityEntry, hidden = false): string {
  const amount = hidden ? "money" : `${money(entry.amount.amount)} ${entry.amount.asset}`;
  if (entry.kind === "claim") {
    return hidden ? "Money that was waiting for you just landed." : `${amount} that was waiting for you just landed.`;
  }
  const from = entry.counterparty;
  if (from?.startsWith("@")) return `${from} sent you ${amount}.`;
  if (from) return hidden ? `Money arrived from ${from}.` : `${amount} arrived from ${from}.`;
  return hidden ? "Money just came in." : `${amount} just came in.`;
}
