/**
 * Making a money route safe to call twice.
 *
 * Phones lose signal mid-request, people double-tap, and clients retry. Without
 * this, every one of those sends the money again, and the second payment is
 * indistinguishable from a deliberate one. The caller supplies an
 * `Idempotency-Key`; the first request does the work and the answer is kept, and
 * anything repeating that key gets the same answer back rather than a second
 * payment.
 *
 * In memory today, keyed per user so one person's key can never collide with
 * another's. It is an interface for the same reason the other stores are.
 */
export interface IdempotencyRecord {
  status: number;
  body: unknown;
}

export type IdempotencyState =
  /** Never seen. The caller should do the work. */
  | { kind: "fresh" }
  /** The first request is still running. A retry now would race it. */
  | { kind: "in-flight" }
  /** Already done. Give back exactly what the first one said. */
  | { kind: "done"; record: IdempotencyRecord };

export interface IdempotencyStore {
  begin(userId: string, key: string): Promise<IdempotencyState>;
  complete(userId: string, key: string, record: IdempotencyRecord): Promise<void>;
  /** Let go of a key whose work failed, so the caller can genuinely retry. */
  release(userId: string, key: string): Promise<void>;
}

/** Long enough to cover any client retry, short enough to not grow forever. */
const TTL_MS = 24 * 60 * 60 * 1000;

interface Slot {
  at: number;
  record: IdempotencyRecord | null;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #slots = new Map<string, Slot>();

  async begin(userId: string, key: string): Promise<IdempotencyState> {
    this.#prune();
    const id = slotKey(userId, key);
    const slot = this.#slots.get(id);

    if (!slot) {
      // Reserved before the work starts, so a second request arriving while the
      // first is still moving money sees "in-flight" rather than "fresh".
      this.#slots.set(id, { at: Date.now(), record: null });
      return { kind: "fresh" };
    }
    return slot.record ? { kind: "done", record: slot.record } : { kind: "in-flight" };
  }

  async complete(userId: string, key: string, record: IdempotencyRecord): Promise<void> {
    this.#slots.set(slotKey(userId, key), { at: Date.now(), record });
  }

  async release(userId: string, key: string): Promise<void> {
    this.#slots.delete(slotKey(userId, key));
  }

  #prune(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, slot] of this.#slots) {
      if (slot.at < cutoff) this.#slots.delete(id);
    }
  }
}

const slotKey = (userId: string, key: string): string => `${userId}:${key}`;
