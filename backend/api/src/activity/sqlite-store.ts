import { randomUUID } from "node:crypto";
import type { HandleRef, HistoryEntry, HistoryKind, HistoryStatus } from "@selkie/core";
import { orNull, orUndefined, type Db } from "../db/open";
import { ActivityNotFoundError, type ActivityStore, type NewActivity } from "./store";

interface Row {
  id: string;
  user_id: string;
  kind: string;
  chain: string;
  amount: string;
  asset: string;
  counterparty: string | null;
  counterparty_platform: string | null;
  counterparty_username: string | null;
  status: string;
  at: string;
  ref: string | null;
  claim_ref: string | null;
  refundable_at: string | null;
}

/** What someone did with their money, on disk. */
export class SqliteActivityStore implements ActivityStore {
  constructor(private readonly db: Db) {}

  async record(userId: string, entry: NewActivity): Promise<HistoryEntry> {
    const saved: HistoryEntry = {
      ...entry,
      id: `act_${randomUUID()}`,
      at: entry.at ?? new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO activity
           (id, user_id, kind, chain, amount, asset, counterparty,
            counterparty_platform, counterparty_username, status, at, ref,
            claim_ref, refundable_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        saved.id,
        userId,
        saved.kind,
        saved.chain,
        saved.amount.amount,
        saved.amount.asset,
        orNull(saved.counterparty),
        orNull(saved.counterpartyHandle?.platform),
        orNull(saved.counterpartyHandle?.username),
        saved.status,
        saved.at,
        orNull(saved.ref),
        orNull(saved.claimRef),
        orNull(saved.refundableAt),
      );

    return saved;
  }

  async list(userId: string, options?: { limit?: number }): Promise<HistoryEntry[]> {
    const rows = this.db
      .prepare("SELECT * FROM activity WHERE user_id = ? ORDER BY at DESC, rowid DESC LIMIT ?")
      .all(userId, options?.limit ?? 50) as unknown as Row[];
    return rows.map(hydrate);
  }

  async findByClaimRef(userId: string, claimRef: string): Promise<HistoryEntry | null> {
    const row = this.db
      .prepare("SELECT * FROM activity WHERE user_id = ? AND claim_ref = ? LIMIT 1")
      .get(userId, claimRef) as Row | undefined;
    return row ? hydrate(row) : null;
  }

  async settle(
    userId: string,
    id: string,
    status: HistoryStatus,
    ref?: string,
  ): Promise<HistoryEntry> {
    const changed = this.db
      .prepare(
        "UPDATE activity SET status = ?, ref = COALESCE(?, ref) WHERE id = ? AND user_id = ?",
      )
      .run(status, orNull(ref), id, userId);

    if (changed.changes === 0) throw new ActivityNotFoundError(id);

    const row = this.db.prepare("SELECT * FROM activity WHERE id = ?").get(id) as unknown as Row;
    return hydrate(row);
  }

  async settleByClaimRef(claimRef: string, status: HistoryStatus, ref?: string): Promise<void> {
    // Only money still waiting moves on. A payment already returned to its
    // sender must never be re-marked as delivered, which is what the status
    // check in the WHERE clause is for.
    this.db
      .prepare(
        `UPDATE activity SET status = ?, ref = COALESCE(?, ref)
         WHERE claim_ref = ? AND status = 'pending'`,
      )
      .run(status, orNull(ref), claimRef);
  }
}

function hydrate(row: Row): HistoryEntry {
  const handle: HandleRef | undefined =
    row.counterparty_platform && row.counterparty_username
      ? {
          platform: row.counterparty_platform as HandleRef["platform"],
          username: row.counterparty_username,
        }
      : undefined;

  return {
    id: row.id,
    kind: row.kind as HistoryKind,
    chain: row.chain as HistoryEntry["chain"],
    amount: { amount: row.amount, asset: row.asset },
    counterparty: orUndefined(row.counterparty),
    counterpartyHandle: handle,
    status: row.status as HistoryStatus,
    at: row.at,
    ref: orUndefined(row.ref),
    claimRef: orUndefined(row.claim_ref),
    refundableAt: orUndefined(row.refundable_at),
  };
}
