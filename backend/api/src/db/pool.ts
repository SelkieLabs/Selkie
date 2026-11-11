import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * The connection pool, and the one rule everything else here follows.
 *
 * Money is `numeric` in the database and a decimal string in TypeScript, and it
 * is never a float in between. `pg` already hands back `numeric` as a string
 * rather than parsing it into a double, which is exactly what is wanted: a
 * balance that goes through a JavaScript number has already lost the argument.
 * Nothing in this file may undo that.
 */
export function openPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    // Small on purpose. The API is not query-bound, and a pool larger than the
    // database's own connection limit turns a busy moment into an outage.
    max: 10,
    idleTimeoutMillis: 30_000,
    // A connection that cannot be had in ten seconds is not going to help the
    // request that is waiting for it.
    connectionTimeoutMillis: 10_000,
  });
}

/**
 * Run several statements as one, or none of them.
 *
 * Used wherever more than one row has to change together: settling a request
 * and writing the activity that proves it, releasing waiting money and marking
 * the sender's side of it. Half of that pair landing is how a feed starts
 * telling two different stories about the same payment.
 *
 * The client is released on every path, including a rollback that itself fails,
 * because a leaked connection takes the pool down slowly and blames something
 * else on the way.
 */
export async function inTransaction<T>(pool: Pool, work: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // The original error is the one worth reporting. A rollback that fails on
      // an already-broken connection would only bury it.
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Somewhere to run a query: the pool itself, or a transaction in progress. */
export interface Queryable {
  query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

/** A timestamptz column as the ISO string the rest of Selkie speaks. */
export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
