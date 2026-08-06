import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { migrate } from "./migrate";

/**
 * A real database for a test run.
 *
 * Real, not a stand-in, because everything worth testing down here is something
 * only Postgres does: a primary key refusing a second row, a constraint
 * rejecting a shape, two connections racing for the same key. A fake would
 * agree with whatever the code did and prove nothing.
 *
 * Each run gets its own schema, so test files can run at the same time without
 * deleting each other's rows, and a crashed run leaves a droppable schema
 * rather than a poisoned database.
 */
export interface TestDatabase {
  pool: Pool;
  done: () => Promise<void>;
}

export function testDatabaseUrl(): string | null {
  return process.env.DATABASE_URL_TEST ?? null;
}

export async function openTestDatabase(): Promise<TestDatabase> {
  const url = testDatabaseUrl();
  if (!url) throw new Error("DATABASE_URL_TEST is not set.");

  const schema = `test_${randomUUID().replace(/-/g, "")}`;

  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`create schema "${schema}"`);
  await admin.end();

  // search_path on every connection in the pool, so the migrations and every
  // query after them land in this run's schema without a single table name
  // having to know about it.
  // Room for the concurrency tests to actually be concurrent. A pool of one
  // would serialise them and they would pass without proving anything.
  const pool = new Pool({ connectionString: url, max: 10, options: `-c search_path="${schema}"` });
  await migrate(pool);

  // Every connection opened up front, for the same reason. A cold pool dials
  // out one client at a time, which is slow enough that eight "simultaneous"
  // requests arrive in single file and a broken store passes.
  await Promise.all(Array.from({ length: 10 }, () => pool.query("select 1")));

  return {
    pool,
    done: async () => {
      await pool.end();
      const cleanup = new Pool({ connectionString: url, max: 1 });
      await cleanup.query(`drop schema "${schema}" cascade`);
      await cleanup.end();
    },
  };
}

/** A user to hang rows off, since most tables have a foreign key to one. */
export async function someone(
  pool: Pool,
  { address = `G${randomUUID().replace(/-/g, "").toUpperCase()}`, username = "amaka" } = {},
): Promise<{ id: string; address: string }> {
  const id = randomUUID();
  await pool.query("insert into users (id, address) values ($1, $2)", [id, address]);
  await pool.query(
    `insert into identities (provider, subject, user_id, username, attestation)
     values ('x', $1, $2, $3, 'login')`,
    [randomUUID(), id, username],
  );
  return { id, address };
}
