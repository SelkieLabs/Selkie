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
  | { kind: "done"; record: IdempotencyRecord }
  /**
   * This key was used for a different request.
   *
   * Never answerable, and never silently. A key that stands for one payment
   * cannot stand for another, and handing back the first one's "sent" for a
   * second, different payment tells somebody their money moved when it did
   * not. That is the one failure a payments API must never have, so it is an
   * error rather than a cache hit.
   */
  | { kind: "mismatch" };

export interface IdempotencyStore {
  /**
   * Claim a key for a request.
   *
   * The fingerprint is what the caller is asking for, so a key reused for
   * something else is caught rather than answered.
   */
  begin(userId: string, key: string, fingerprint: string): Promise<IdempotencyState>;
  complete(userId: string, key: string, record: IdempotencyRecord): Promise<void>;
  /** Let go of a key whose work failed, so the caller can genuinely retry. */
  release(userId: string, key: string): Promise<void>;
}

/** Long enough to cover any client retry, short enough to not grow forever. */
const TTL_MS = 24 * 60 * 60 * 1000;

interface Slot {
  at: number;
  record: IdempotencyRecord | null;
  /** What was asked for the first time this key was used. */
  fingerprint: string;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #slots = new Map<string, Slot>();

  async begin(userId: string, key: string, fingerprint: string): Promise<IdempotencyState> {
    this.#prune();
    const id = slotKey(userId, key);
    const slot = this.#slots.get(id);

    if (!slot) {
      // Reserved before the work starts, so a second request arriving while the
      // first is still moving money sees "in-flight" rather than "fresh".
      this.#slots.set(id, { at: Date.now(), record: null, fingerprint });
      return { kind: "fresh" };
    }

    // Checked before anything is handed back, because the whole point is that
    // the answer belongs to the first request and not to this one.
    if (slot.fingerprint !== fingerprint) return { kind: "mismatch" };

    return slot.record ? { kind: "done", record: slot.record } : { kind: "in-flight" };
  }

  async complete(userId: string, key: string, record: IdempotencyRecord): Promise<void> {
    const id = slotKey(userId, key);
    const slot = this.#slots.get(id);
    // Keep the fingerprint the key was claimed with. Losing it here would let
    // the next different request through as an ordinary replay.
    this.#slots.set(id, { at: Date.now(), record, fingerprint: slot?.fingerprint ?? "" });
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
