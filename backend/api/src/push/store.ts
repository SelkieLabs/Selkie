/** One browser that asked to be told when money comes in. */
export interface PushSubscriptionRecord {
  /** The push service's URL for this browser. Unique per browser. */
  endpoint: string;
  userId: string;
  /** The browser's keys; every message is encrypted to them. */
  p256dh: string;
  auth: string;
}

/** Enough for a phone, a laptop and a few old browsers; the oldest go first. */
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

export interface PushStore {
  /**
   * Remember a browser for this user. A browser that was signed in as someone
   * else moves over: one browser, one person to notify.
   */
  save(record: PushSubscriptionRecord): Promise<void>;
  forUser(userId: string): Promise<PushSubscriptionRecord[]>;
  /** Forget a browser. With `userId`, only if it is that user's. */
  remove(endpoint: string, userId?: string): Promise<void>;
}

export class InMemoryPushStore implements PushStore {
  /** endpoint -> record, in the order they were saved. */
  readonly #rows = new Map<string, PushSubscriptionRecord>();

  async save(record: PushSubscriptionRecord) {
    this.#rows.delete(record.endpoint);
    this.#rows.set(record.endpoint, { ...record });
    const mine = [...this.#rows.values()].filter((row) => row.userId === record.userId);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_SUBSCRIPTIONS_PER_USER))) {
      this.#rows.delete(old.endpoint);
    }
  }

  async forUser(userId: string) {
    return [...this.#rows.values()].filter((row) => row.userId === userId).map((row) => ({ ...row }));
  }

  async remove(endpoint: string, userId?: string) {
    const row = this.#rows.get(endpoint);
    if (row && (userId === undefined || row.userId === userId)) this.#rows.delete(endpoint);
  }
}
