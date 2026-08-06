/**
 * Somewhere state survives a restart.
 *
 * Selkie's stores are maps in memory, which is the right shape for a store and
 * the wrong shape for money. A restart took the private key of every account
 * with it, and money at an address whose key is gone is not lost the way a
 * database row is lost: it is on the ledger, visible to everyone, and nobody
 * will ever move it again. The same restart forgot who owned which handle, so
 * the next person to sign in got a brand new empty wallet and no explanation.
 *
 * Every store holding something worth keeping now writes through here.
 *
 * Deliberately synchronous. A store that has handed out a wallet address and
 * not yet written down the key for it has a window in which a crash costs
 * somebody their savings, and the only width of that window worth having is
 * none. The data is small and the write is a few hundred microseconds; buying
 * that back with an await would be a poor trade.
 *
 * Postgres replaces the implementation, not the interface.
 */
export interface Keep {
  /** Whatever was last written under this name, or undefined on a fresh start. */
  read<T>(shelf: string): T | undefined;
  /** Write it down. Returns once it is durable. */
  write(shelf: string, value: unknown): void;
}

/**
 * A Keep that forgets.
 *
 * The default everywhere, so a store built without one behaves exactly as it
 * always did, and so a test suite does not litter the disk.
 */
export class Forgetful implements Keep {
  read<T>(): T | undefined {
    return undefined;
  }

  write(): void {}
}

/**
 * A Keep that remembers only for as long as the process does.
 *
 * Useful for proving that a store really does reload what it wrote: build one
 * store, throw it away, build another from the same Keep, and the second one
 * has to know everything the first one did. That is a restart, without a file.
 */
export class MemoryKeep implements Keep {
  readonly #shelves = new Map<string, string>();

  read<T>(shelf: string): T | undefined {
    const stored = this.#shelves.get(shelf);
    return stored === undefined ? undefined : (JSON.parse(stored) as T);
  }

  write(shelf: string, value: unknown): void {
    // Serialised rather than held by reference, so a caller that keeps mutating
    // the object it wrote cannot silently change what is on the shelf. A file
    // would not let it, and a stand-in that is more forgiving than the real
    // thing proves nothing.
    this.#shelves.set(shelf, JSON.stringify(value));
  }
}
