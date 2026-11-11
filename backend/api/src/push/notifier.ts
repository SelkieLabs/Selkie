import webpush from "web-push";
import type { ArrivalNotice, Notifier } from "../notify/arrival";
import type { PushStore, PushSubscriptionRecord } from "./store";

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
export class PushNotifier implements Notifier {
  readonly #inFlight = new Set<Promise<void>>();

  constructor(
    private readonly deps: {
      store: PushStore;
      send: PushSend;
      onError?: (error: unknown) => void;
    },
  ) {}

  /** Start sending; returns at once. */
  notify(userId: string, message: ArrivalNotice): void {
    const job = this.#deliver(userId, message).finally(() => this.#inFlight.delete(job));
    this.#inFlight.add(job);
  }

  /** Wait for everything started so far. For shutdown, and for tests. */
  async settled(): Promise<void> {
    while (this.#inFlight.size > 0) await Promise.allSettled([...this.#inFlight]);
  }

  async #deliver(userId: string, message: ArrivalNotice): Promise<void> {
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
