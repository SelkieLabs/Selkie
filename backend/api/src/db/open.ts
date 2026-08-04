import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The database, opened once at boot.
 *
 * SQLite rather than a server, deliberately: Selkie runs as one API process, and
 * a file on a volume has no connection pool to exhaust, no second service to
 * keep alive, and no network hop in the middle of a payment. The stores are all
 * interfaces, so the day a second instance is needed, Postgres is one new class
 * per interface and the SQL below barely changes.
 *
 * What is NOT in here is the money. Balances live on the ledger; this holds who
 * someone is, what they did, and which handle owns which address.
 */
export type Db = DatabaseSync;

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Open a database and bring it up to date.
 *
 * `:memory:` is a real option and is what the tests use, so the exact same code
 * that runs in production runs against a fresh database in a few milliseconds.
 */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec(readFileSync(resolve(HERE, "schema.sql"), "utf8"));
  return db;
}

/**
 * Run a block of writes as one transaction.
 *
 * Used wherever a single product action is more than one statement — creating a
 * user and their identities, merging two accounts — because a half-applied
 * merge is an account whose money is somewhere its owner cannot see.
 */
export function transact<T>(db: Db, run: () => T): T {
  db.exec("BEGIN");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** SQLite has no boolean; it has 1 and 0, and this is where that stops. */
export const toBool = (value: unknown): boolean => value === 1 || value === 1n;
export const fromBool = (value: boolean): number => (value ? 1 : 0);

/** Undefined is not a bindable value in SQLite, but null is. */
export const orNull = <T>(value: T | undefined): T | null => value ?? null;

/** Nulls come back out of the database; the domain types use undefined. */
export const orUndefined = <T>(value: T | null | undefined): T | undefined => value ?? undefined;
