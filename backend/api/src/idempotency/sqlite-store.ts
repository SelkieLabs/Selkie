import type { Db } from "../db/open";
import type { IdempotencyRecord, IdempotencyState, IdempotencyStore } from "./store";

/** Long enough to cover any client retry, short enough to not grow forever. */
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Answers already given, on disk.
 *
 * Persisted for the same reason the payment is: a server that restarts between
 * a payment and its retry would otherwise send the money a second time, and a
 * restart is exactly the kind of thing that happens right after a request took
 * suspiciously long.
 */
export class SqliteIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Db) {}

  async begin(userId: string, key: string): Promise<IdempotencyState> {
    this.#prune();

    // Reserved before the work starts, so a second request arriving while the
    // first is still moving money sees "in-flight" rather than "fresh". The
    // insert is the lock: if it succeeds, this caller owns the key.
    const claimed = this.db
      .prepare(
        `INSERT INTO idempotency (user_id, key, status, body, at)
         VALUES (?, ?, NULL, NULL, ?)
         ON CONFLICT (user_id, key) DO NOTHING`,
      )
      .run(userId, key, new Date().toISOString());

    if (claimed.changes > 0) return { kind: "fresh" };

    const row = this.db
      .prepare("SELECT status, body FROM idempotency WHERE user_id = ? AND key = ?")
      .get(userId, key) as { status: number | null; body: string | null } | undefined;

    if (!row || row.body === null) return { kind: "in-flight" };
    return {
      kind: "done",
      record: { status: row.status ?? 200, body: JSON.parse(row.body) as unknown },
    };
  }

  async complete(userId: string, key: string, record: IdempotencyRecord): Promise<void> {
    this.db
      .prepare(
        `UPDATE idempotency SET status = ?, body = ?, at = ? WHERE user_id = ? AND key = ?`,
      )
      .run(record.status, JSON.stringify(record.body ?? null), new Date().toISOString(), userId, key);
  }

  async release(userId: string, key: string): Promise<void> {
    this.db.prepare("DELETE FROM idempotency WHERE user_id = ? AND key = ?").run(userId, key);
  }

  #prune(): void {
    this.db
      .prepare("DELETE FROM idempotency WHERE at < ?")
      .run(new Date(Date.now() - TTL_MS).toISOString());
  }
}
