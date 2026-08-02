import type { HistoryEntry } from "@selkie/core";

/**
 * What someone did with their money, described the way they would describe it.
 *
 * This is product state, not chain state, and that is deliberate. The ledger
 * knows one address paid another; it does not know you paid @amaka. Worse, money
 * released by the escrow contract moves inside a contract call and never appears
 * in a classic payment feed at all, so reading history back off the chain would
 * show fewer events than actually happened, described worse. Selkie writes the
 * entry at the moment it does the thing.
 *
 * In memory today. It is an interface, and Postgres is the only implementation
 * that needs to change.
 */
export interface ActivityStore {
  record(userId: string, entry: NewActivity): Promise<HistoryEntry>;
  list(userId: string, options?: { limit?: number }): Promise<HistoryEntry[]>;
}

/** An entry before it is stored: the store owns the id and the timestamp. */
export type NewActivity = Omit<HistoryEntry, "id" | "at"> & { at?: string };

export class InMemoryActivityStore implements ActivityStore {
  readonly #byUser = new Map<string, HistoryEntry[]>();
  #sequence = 0;

  async record(userId: string, entry: NewActivity): Promise<HistoryEntry> {
    const saved: HistoryEntry = {
      ...entry,
      id: `act_${++this.#sequence}`,
      at: entry.at ?? new Date().toISOString(),
    };
    // Newest first on write, so reading a feed never sorts.
    const rows = this.#byUser.get(userId) ?? [];
    rows.unshift(saved);
    this.#byUser.set(userId, rows);
    return saved;
  }

  async list(userId: string, options?: { limit?: number }): Promise<HistoryEntry[]> {
    const rows = this.#byUser.get(userId) ?? [];
    return rows.slice(0, options?.limit ?? 50);
  }
}
