import type { HistoryEntry } from "@selkie/core";
import type { ActivityStore, NewActivity } from "../activity/store";

/** What a "money in" notice says, wherever it is shown (push, email). */
export interface ArrivalNotice {
  title: string;
  /** "@tunde sent you 2.00 USDC." */
  body: string;
  /** Path in the web app to open. */
  url: string;
  /** Same tag, same notice: one delivered twice shows once. */
  tag: string;
}

/** A way of telling someone. Never throws and never makes the caller wait. */
export interface Notifier {
  notify(userId: string, notice: ArrivalNotice): void;
  /** Wait for everything started so far. For shutdown, and for tests. */
  settled(): Promise<void>;
}

const INCOMING = new Set<HistoryEntry["kind"]>(["receive", "claim"]);

/**
 * The words for money coming in, or null for anything else.
 *
 * Mirrors the in-app toast (frontend/src/lib/useArrivals.ts) so the phone, the
 * inbox and the open tab all say the same thing.
 */
export function arrivalNotice(
  entry: Pick<HistoryEntry, "id" | "kind" | "status" | "amount" | "counterparty">,
): ArrivalNotice | null {
  if (!INCOMING.has(entry.kind) || entry.status === "failed") return null;
  const amount = `${displayAmount(entry.amount.amount)} ${entry.amount.asset}`;
  const from = entry.counterparty;
  const body =
    entry.kind === "claim"
      ? `${amount} that was waiting for you just landed.`
      : from?.startsWith("@")
        ? `${from} sent you ${amount}.`
        : from
          ? `${amount} arrived from ${from}.`
          : `${amount} just came in.`;
  return { title: "Money in", body, url: "/wallet/home", tag: `activity-${entry.id}` };
}

/** "1234.5" -> "1,234.50". Strings all the way: money never goes through a float. */
export function displayAmount(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}

/**
 * The activity store, plus a notice to every notifier whenever money in is
 * written to it.
 *
 * The feed is the one place every way money arrives already passes through
 * (a Selkie user paying you, a claim, money from outside Selkie), so hooking
 * here means a new way of receiving can never forget to tell anyone.
 */
export function notifyingActivity(activity: ActivityStore, notifiers: Notifier[]): ActivityStore {
  return {
    record: async (userId: string, entry: NewActivity) => {
      const saved = await activity.record(userId, entry);
      const notice = arrivalNotice(saved);
      if (notice) for (const notifier of notifiers) notifier.notify(userId, notice);
      return saved;
    },
    list: (userId, options) => activity.list(userId, options),
    findByClaimRef: (userId, claimRef) => activity.findByClaimRef(userId, claimRef),
    settle: (userId, id, status, ref) => activity.settle(userId, id, status, ref),
    settleByClaimRef: (claimRef, status, ref) => activity.settleByClaimRef(claimRef, status, ref),
  };
}
