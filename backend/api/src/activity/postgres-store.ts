import type { HandleRef, HistoryEntry, HistoryKind, HistoryStatus } from "@selkie/core";
import { iso, type Queryable } from "../db/pool";
import { ActivityNotFoundError, type ActivityStore, type NewActivity } from "./store";

/**
 * The activity feed, in Postgres.
 *
 * Amounts are `numeric`, and `pg` hands `numeric` back as a string rather than
 * parsing it into a double. That is not an accident of the driver worth working
 * around: it is the reason this column type was chosen. A balance that has been
 * through a JavaScript number has already lost, and no amount of formatting on
 * the way out gets the missing fraction back.
 */

const COLUMNS = `
  id, kind, chain, amount_value, amount_asset, counterparty,
  counterparty_platform, counterparty_username, status, at, ref, claim_ref, refundable_at
`;

export class PostgresActivityStore implements ActivityStore {
  constructor(private readonly db: Queryable) {}

  async record(userId: string, entry: NewActivity): Promise<HistoryEntry> {
    const { rows } = await this.db.query<Row>(
      `insert into activity
         (user_id, kind, chain, amount_value, amount_asset, counterparty,
          counterparty_platform, counterparty_username, status, at, ref, claim_ref, refundable_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()), $11, $12, $13)
       returning ${COLUMNS}`,
      [
        userId,
        entry.kind,
        entry.chain,
        entry.amount.amount,
        entry.amount.asset,
        entry.counterparty ?? null,
        entry.counterpartyHandle?.platform ?? null,
        entry.counterpartyHandle?.username ?? null,
        entry.status,
        entry.at ?? null,
        entry.ref ?? null,
        entry.claimRef ?? null,
        entry.refundableAt ?? null,
      ],
    );
    return toEntry(rows[0]!);
  }

  async list(userId: string, options?: { limit?: number }): Promise<HistoryEntry[]> {
    const { rows } = await this.db.query<Row>(
      // Newest first, with the insertion order breaking ties: two payments in
      // the same instant would otherwise come back in whatever order the
      // planner felt like, and the feed would reshuffle between refreshes.
      `select ${COLUMNS} from activity where user_id = $1 order by at desc, seq desc limit $2`,
      [userId, options?.limit ?? 50],
    );
    return rows.map(toEntry);
  }

  /**
   * Scoped to a user on purpose. A payment id is a small integer, and letting
   * anyone name one would let them ask about somebody else's money.
   */
  async findByClaimRef(userId: string, claimRef: string): Promise<HistoryEntry | null> {
    const { rows } = await this.db.query<Row>(
      `select ${COLUMNS} from activity where user_id = $1 and claim_ref = $2 limit 1`,
      [userId, claimRef],
    );
    return rows[0] ? toEntry(rows[0]) : null;
  }

  async settle(
    userId: string,
    id: string,
    status: HistoryStatus,
    ref?: string,
  ): Promise<HistoryEntry> {
    const { rows } = await this.db.query<Row>(
      `update activity set status = $3, ref = coalesce($4, ref)
       where user_id = $1 and id = $2
       returning ${COLUMNS}`,
      [userId, id, status, ref ?? null],
    );
    const row = rows[0];
    if (!row) throw new ActivityNotFoundError(id);
    return toEntry(row);
  }

  /**
   * Settle whoever sent a waiting payment, now that it has landed.
   *
   * Not scoped to a user, unlike `findByClaimRef`: the point is to reach the
   * other person's feed. Escrow ids are globally unique and this is only ever
   * called with one the contract just released, never with user input.
   */
  async settleByClaimRef(claimRef: string, status: HistoryStatus, ref?: string): Promise<void> {
    await this.db.query(
      // Only money still waiting moves on. A payment already returned to its
      // sender must never be re-marked as delivered, and doing that check in
      // the where clause means two servers racing cannot both win.
      `update activity set status = $2, ref = coalesce($3, ref)
       where claim_ref = $1 and status = 'pending'`,
      [claimRef, status, ref ?? null],
    );
  }
}

interface Row {
  id: string;
  kind: HistoryKind;
  chain: string;
  amount_value: string;
  amount_asset: string;
  counterparty: string | null;
  counterparty_platform: string | null;
  counterparty_username: string | null;
  status: HistoryStatus;
  at: Date | string;
  ref: string | null;
  claim_ref: string | null;
  refundable_at: Date | string | null;
}

function toEntry(row: Row): HistoryEntry {
  const handle: HandleRef | null =
    row.counterparty_platform && row.counterparty_username
      ? {
          platform: row.counterparty_platform as HandleRef["platform"],
          username: row.counterparty_username,
        }
      : null;

  // Null columns leave as absent rather than as an explicit undefined, which
  // `exactOptionalPropertyTypes` rightly treats as a different thing.
  return {
    id: row.id,
    kind: row.kind,
    chain: row.chain as HistoryEntry["chain"],
    amount: { amount: row.amount_value, asset: row.amount_asset },
    status: row.status,
    at: iso(row.at),
    ...(row.counterparty !== null ? { counterparty: row.counterparty } : {}),
    ...(handle ? { counterpartyHandle: handle } : {}),
    ...(row.ref !== null ? { ref: row.ref } : {}),
    ...(row.claim_ref !== null ? { claimRef: row.claim_ref } : {}),
    ...(row.refundable_at !== null ? { refundableAt: iso(row.refundable_at) } : {}),
  };
}
