import type { Queryable } from "../db/pool";
import type { IdempotencyRecord, IdempotencyState, IdempotencyStore } from "./store";

/**
 * Making a money route safe to call twice, across more than one server.
 *
 * The in-memory version guarded a single process. Two of them behind a load
 * balancer each kept their own copy of the map, so a retry that happened to
 * land on the other one saw a key it had never heard of and did the work again.
 * That is not a cache miss, it is a second real payment, and it is the failure
 * that arrives on the day the service becomes popular enough to need a second
 * server.
 *
 * The claim below is one statement. Postgres decides who gets the key, and the
 * loser is told the truth rather than racing.
 */

/** Long enough to cover any client retry, short enough to not grow forever. */
const TTL = "24 hours";

export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Queryable) {}

  async begin(userId: string, key: string, fingerprint: string): Promise<IdempotencyState> {
    /**
     * Claim it, or take over one that has expired, in a single atomic step.
     *
     * The `where` on the conflict branch is what makes expiry safe: an
     * unexpired row is left exactly as it is and no row comes back, so the
     * caller falls through to reading what is already there. Doing this as
     * select-then-insert would leave a window where two requests both find
     * nothing and both insert, which is the entire bug.
     */
    const { rows: claimed } = await this.db.query<{ ok: boolean }>(
      `insert into idempotency (user_id, key, fingerprint) values ($1, $2, $3)
       on conflict (user_id, key) do update set
         fingerprint  = excluded.fingerprint,
         status       = null,
         body         = null,
         claimed_at   = now(),
         completed_at = null
       where idempotency.claimed_at < now() - interval '${TTL}'
       returning true as ok`,
      [userId, key, fingerprint],
    );
    if (claimed.length > 0) return { kind: "fresh" };

    const { rows } = await this.db.query<{
      fingerprint: string;
      status: number | null;
      body: unknown;
      completed_at: Date | null;
    }>("select fingerprint, status, body, completed_at from idempotency where user_id = $1 and key = $2", [
      userId,
      key,
    ]);

    const slot = rows[0];
    // Gone between the two statements, which only happens if a sweep ran in
    // the gap. Treating that as fresh is right: nothing is holding the key.
    if (!slot) return { kind: "fresh" };

    // Checked before anything is handed back, because the answer belongs to the
    // first request and not to this one. Telling somebody their money moved
    // because an earlier, different payment succeeded is the one thing a
    // payments API must never do.
    if (slot.fingerprint !== fingerprint) return { kind: "mismatch" };

    if (slot.completed_at === null) return { kind: "in-flight" };
    return { kind: "done", record: { status: slot.status ?? 200, body: slot.body } };
  }

  async complete(userId: string, key: string, record: IdempotencyRecord): Promise<void> {
    // The fingerprint is left alone rather than rewritten. Losing what the key
    // was claimed for would let the next different request through as an
    // ordinary replay, which is the whole bug with one extra step.
    await this.db.query(
      `update idempotency set status = $3, body = $4, completed_at = now()
       where user_id = $1 and key = $2`,
      [userId, key, record.status, JSON.stringify(record.body ?? null)],
    );
  }

  /** Let go of a key whose work failed, so the caller can genuinely retry. */
  async release(userId: string, key: string): Promise<void> {
    await this.db.query("delete from idempotency where user_id = $1 and key = $2", [userId, key]);
  }

  /**
   * Drop what nobody can still be retrying.
   *
   * Its own method rather than something done inside `begin`, because a delete
   * scan on every payment is a cost paid by the request that can least afford
   * it. The server calls this on a timer.
   */
  async sweep(): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `with gone as (delete from idempotency where claimed_at < now() - interval '${TTL}' returning 1)
       select count(*) from gone`,
    );
    return Number(rows[0]?.count ?? 0);
  }
}
