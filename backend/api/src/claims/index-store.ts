import type { HandleRef } from "@selkie/core";
import { handleHash, handleKey } from "@selkie/core";
import type { Db } from "../db/open";

/**
 * Which handle a hash on the chain belongs to.
 *
 * The escrow contract only ever sees `sha256("<platform>:<username>")`, and a
 * hash does not run backwards. So noticing that money has arrived for @amaka
 * means having written down, in advance, that a particular hash means @amaka.
 *
 * Not a secret. Anyone can hash a handle they already know and look it up on
 * chain; that is the honest limit of Selkie's privacy story and this changes
 * nothing about it.
 */
export interface HandleIndex {
  /** Note that this handle exists, so money arriving for it can be recognised. */
  remember(handle: HandleRef): Promise<void>;
  find(handleHashHex: string): Promise<HandleRef | null>;
}

/** The hex form the chain and the RPC both speak. */
export async function handleHashHex(handle: HandleRef): Promise<string> {
  return Buffer.from(await handleHash(handle)).toString("hex");
}

export class InMemoryHandleIndex implements HandleIndex {
  readonly #byHash = new Map<string, HandleRef>();

  async remember(handle: HandleRef): Promise<void> {
    this.#byHash.set(await handleHashHex(handle), handle);
  }

  async find(hash: string): Promise<HandleRef | null> {
    return this.#byHash.get(hash.toLowerCase()) ?? null;
  }
}

export class SqliteHandleIndex implements HandleIndex {
  constructor(private readonly db: Db) {}

  async remember(handle: HandleRef): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO handle_index (handle_hash, platform, username) VALUES (?, ?, ?)
         ON CONFLICT (handle_hash) DO NOTHING`,
      )
      .run(await handleHashHex(handle), handle.platform, handle.username);
  }

  async find(hash: string): Promise<HandleRef | null> {
    const row = this.db
      .prepare("SELECT platform, username FROM handle_index WHERE handle_hash = ?")
      .get(hash.toLowerCase()) as { platform: string; username: string } | undefined;
    return row
      ? { platform: row.platform as HandleRef["platform"], username: row.username }
      : null;
  }
}

/** Where a background reader got to. */
export interface CursorStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
}

export class InMemoryCursorStore implements CursorStore {
  readonly #values = new Map<string, string>();

  async get(name: string): Promise<string | null> {
    return this.#values.get(name) ?? null;
  }

  async set(name: string, value: string): Promise<void> {
    this.#values.set(name, value);
  }
}

export class SqliteCursorStore implements CursorStore {
  constructor(private readonly db: Db) {}

  async get(name: string): Promise<string | null> {
    const row = this.db.prepare("SELECT value FROM cursors WHERE name = ?").get(name) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  async set(name: string, value: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO cursors (name, value) VALUES (?, ?)
         ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
      )
      .run(name, value);
  }
}

/** Re-exported so callers can key their own maps the same way the chain does. */
export { handleKey };
