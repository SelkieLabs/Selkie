import { Forgetful, type HistoryEntry, type HistoryStatus, type Keep } from "@selkie/core";

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
  /**
   * Find one waiting payment by the escrow's id for it.
   *
   * Scoped to a user on purpose: a payment id is a small integer, and letting
   * anyone name one would let them ask about somebody else's money.
   */
  findByClaimRef(userId: string, claimRef: string): Promise<HistoryEntry | null>;
  /**
   * Move an entry on. Payments are not finished when they are written: money
   * sent to a handle nobody has claimed sits at `pending` until it lands or
   * comes back, and an entry that never leaves `pending` is a lie the feed
   * keeps telling.
   */
  settle(userId: string, id: string, status: HistoryStatus, ref?: string): Promise<HistoryEntry>;
  /**
   * Settle whoever sent a waiting payment, now that it has landed.
   *
   * Not scoped to a user, unlike `findByClaimRef`: the point is to reach the
   * *other* person's feed. Escrow ids are globally unique and this is only ever
   * called with one the contract just released, never with user input.
   */
  settleByClaimRef(claimRef: string, status: HistoryStatus, ref?: string): Promise<void>;
}

/** An entry before it is stored: the store owns the id and the timestamp. */
export type NewActivity = Omit<HistoryEntry, "id" | "at"> & { at?: string };

export class ActivityNotFoundError extends Error {}

const SHELF = "activity";

/** What goes on the shelf. The counter travels with the rows it numbered. */
interface Saved {
  sequence: number;
  byUser: Record<string, HistoryEntry[]>;
}

export class InMemoryActivityStore implements ActivityStore {
  readonly #byUser = new Map<string, HistoryEntry[]>();
  readonly #keep: Keep;
  #sequence = 0;

  constructor(keep: Keep = new Forgetful()) {
    this.#keep = keep;
    const saved = keep.read<Saved>(SHELF);
    if (!saved) return;
    // The counter is restored along with the rows. Starting it back at zero
    // would hand `act_1` to a second entry while the first one still had it,
    // and settling one by id would then reach the wrong payment.
    this.#sequence = saved.sequence;
    for (const [userId, rows] of Object.entries(saved.byUser)) this.#byUser.set(userId, rows);
  }

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
    this.#save();
    return structuredClone(saved);
  }

  async list(userId: string, options?: { limit?: number }): Promise<HistoryEntry[]> {
    const rows = this.#byUser.get(userId) ?? [];
    return structuredClone(rows.slice(0, options?.limit ?? 50));
  }

  async findByClaimRef(userId: string, claimRef: string): Promise<HistoryEntry | null> {
    const found = (this.#byUser.get(userId) ?? []).find((row) => row.claimRef === claimRef);
    return found ? structuredClone(found) : null;
  }

  async settle(
    userId: string,
    id: string,
    status: HistoryStatus,
    ref?: string,
  ): Promise<HistoryEntry> {
    const row = (this.#byUser.get(userId) ?? []).find((entry) => entry.id === id);
    if (!row) throw new ActivityNotFoundError(id);
    row.status = status;
    if (ref) row.ref = ref;
    this.#save();
    return structuredClone(row);
  }

  async settleByClaimRef(claimRef: string, status: HistoryStatus, ref?: string): Promise<void> {
    for (const rows of this.#byUser.values()) {
      for (const row of rows) {
        // Only money still waiting moves on. A payment already returned to its
        // sender must never be re-marked as delivered.
        if (row.claimRef !== claimRef || row.status !== "pending") continue;
        row.status = status;
        if (ref) row.ref = ref;
      }
    }
    this.#save();
  }

  #save(): void {
    this.#keep.write(SHELF, {
      sequence: this.#sequence,
      byUser: Object.fromEntries(this.#byUser),
    } satisfies Saved);
  }
}
