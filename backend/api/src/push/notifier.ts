import webpush from "web-push";
import type { HistoryEntry } from "@selkie/core";
import type { ActivityStore, NewActivity } from "../activity/store";
import type { PushStore, PushSubscriptionRecord } from "./store";

/** What the notification says, and where tapping it goes. */
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  /** Same tag, same notification: a message delivered twice shows once. */
  tag: string;
}

/** Deliver one encrypted payload. Throws an error with `statusCode` when the push service refuses. */
export type PushSend = (subscription: PushSubscriptionRecord, payload: string) => Promise<void>;

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** How a push service reaches whoever runs this server: an https: or mailto: URL. */
  subject: string;
}

/** A day: money news older than that is not news, so the push service may drop it. */
const TTL_SECONDS = 24 * 60 * 60;

export function webPushSender(vapid: VapidKeys): PushSend {
  return async (subscription, payload) => {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      payload,
      { vapidDetails: vapid, TTL: TTL_SECONDS, urgency: "high", timeout: 10_000 },
    );
  };
}

/**
 * Sends a notification to every browser a person turned them on in.
 *
 * Never throws and never makes a payment wait: a push service being slow or
 * down must not turn a payment that went through into an error. Browsers the
 * push service says are gone (404/410: uninstalled, permission revoked) are
 * forgotten, so a dead browser is not retried forever.
 */
export class PushNotifier {
  readonly #inFlight = new Set<Promise<void>>();

  constructor(
    private readonly deps: {
      store: PushStore;
      send: PushSend;
      onError?: (error: unknown) => void;
    },
  ) {}

  /** Start sending; returns at once. */
  notify(userId: string, message: PushMessage): void {
    const job = this.#deliver(userId, message).finally(() => this.#inFlight.delete(job));
    this.#inFlight.add(job);
  }

  /** Wait for everything started so far. For shutdown, and for tests. */
  async settled(): Promise<void> {
    while (this.#inFlight.size > 0) await Promise.allSettled([...this.#inFlight]);
  }

  async #deliver(userId: string, message: PushMessage): Promise<void> {
    try {
      const payload = JSON.stringify(message);
      for (const subscription of await this.deps.store.forUser(userId)) {
        try {
          await this.deps.send(subscription, payload);
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await this.deps.store.remove(subscription.endpoint);
          else this.deps.onError?.(error);
        }
      }
    } catch (error) {
      this.deps.onError?.(error);
    }
  }
}

const INCOMING = new Set<HistoryEntry["kind"]>(["receive", "claim"]);

/**
 * The words for money coming in, or null for anything else.
 *
 * Mirrors the in-app toast (frontend/src/lib/useArrivals.ts) so the phone and
 * the open tab say the same thing.
 */
export function arrivalMessage(entry: Pick<HistoryEntry, "id" | "kind" | "status" | "amount" | "counterparty">): PushMessage | null {
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
 * The activity store, plus a notification whenever money in is written to it.
 *
 * The feed is the one place every way money arrives already passes through
 * (a Selkie user paying you, a claim, money from outside Selkie), so hooking
 * here means a new way of receiving can never forget to notify.
 */
export function notifyingActivity(activity: ActivityStore, notifier: PushNotifier): ActivityStore {
  return {
    record: async (userId: string, entry: NewActivity) => {
      const saved = await activity.record(userId, entry);
      const message = arrivalMessage(saved);
      if (message) notifier.notify(userId, message);
      return saved;
    },
    list: (userId, options) => activity.list(userId, options),
    findByClaimRef: (userId, claimRef) => activity.findByClaimRef(userId, claimRef),
    settle: (userId, id, status, ref) => activity.settle(userId, id, status, ref),
    settleByClaimRef: (claimRef, status, ref) => activity.settleByClaimRef(claimRef, status, ref),
  };
}
