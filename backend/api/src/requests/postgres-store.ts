import type { HandleRef } from "@selkie/core";
import { iso, type Queryable } from "../db/pool";
import type { MoneyRequest, NewRequest, RequestStatus, RequestStore } from "./store";

/**
 * Asking someone for money, in Postgres.
 *
 * A request outlives the process by design. It sits there until the person it
 * names signs in, which may be days, so this is the store where "we restarted"
 * and "we lost it" were most obviously the same thing.
 */

const COLUMNS = `
  id, from_user_id, from_platform, from_username, to_platform, to_username,
  amount_value, amount_asset, note, status, created_at, settled_at, ref
`;

export class PostgresRequestStore implements RequestStore {
  constructor(private readonly db: Queryable) {}

  async create(input: NewRequest): Promise<MoneyRequest> {
    const { rows } = await this.db.query<Row>(
      `insert into money_requests
         (from_user_id, from_platform, from_username, to_platform, to_username,
          amount_value, amount_asset, note, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       returning ${COLUMNS}`,
      [
        input.fromUserId,
        input.fromHandle.platform,
        input.fromHandle.username,
        input.toHandle.platform,
        input.toHandle.username,
        input.amount.amount,
        input.amount.asset,
        input.note ?? null,
      ],
    );
    return toRequest(rows[0]!);
  }

  async get(id: string): Promise<MoneyRequest | null> {
    const { rows } = await this.db.query<Row>(`select ${COLUMNS} from money_requests where id = $1`, [
      id,
    ]);
    return rows[0] ? toRequest(rows[0]) : null;
  }

  async settle(id: string, status: RequestStatus, ref?: string): Promise<MoneyRequest> {
    const { rows } = await this.db.query<Row>(
      // Only a pending request can be settled. Two people tapping "pay" at the
      // same moment would otherwise both get through, and the second one would
      // be a real second payment against a request that was already answered.
      `update money_requests
       set status = $2, settled_at = now(), ref = coalesce($3, ref)
       where id = $1 and status = 'pending'
       returning ${COLUMNS}`,
      [id, status, ref ?? null],
    );

    const row = rows[0];
    if (row) return toRequest(row);

    // Nothing was updated, so somebody settled it first. Deliberately NOT an
    // error: the caller reaches this line just after moving real money, and
    // throwing here would report a failed payment that in fact succeeded. The
    // request is settled either way, which is what it asked for, so hand back
    // the row that won.
    const existing = await this.get(id);
    if (!existing) throw new Error(`No such request: ${id}`);
    return existing;
  }

  async sentBy(userId: string): Promise<MoneyRequest[]> {
    const { rows } = await this.db.query<Row>(
      `select ${COLUMNS} from money_requests where from_user_id = $1 order by created_at desc, seq desc`,
      [userId],
    );
    return rows.map(toRequest);
  }

  /** Requests waiting for any of these handles. Case-insensitive, as routing is. */
  async addressedTo(handles: HandleRef[]): Promise<MoneyRequest[]> {
    if (handles.length === 0) return [];

    const { rows } = await this.db.query<Row>(
      `select ${COLUMNS} from money_requests
       where (to_platform, lower(to_username)) in (
         select * from unnest($1::text[], $2::text[])
       )
       order by created_at desc, seq desc`,
      [handles.map((h) => h.platform), handles.map((h) => h.username.toLowerCase())],
    );
    return rows.map(toRequest);
  }
}

interface Row {
  id: string;
  from_user_id: string;
  from_platform: string;
  from_username: string;
  to_platform: string;
  to_username: string;
  amount_value: string;
  amount_asset: string;
  note: string | null;
  status: RequestStatus;
  created_at: Date | string;
  settled_at: Date | string | null;
  ref: string | null;
}

function toRequest(row: Row): MoneyRequest {
  return {
    id: row.id,
    fromUserId: row.from_user_id,
    fromHandle: { platform: row.from_platform as HandleRef["platform"], username: row.from_username },
    toHandle: { platform: row.to_platform as HandleRef["platform"], username: row.to_username },
    amount: { amount: row.amount_value, asset: row.amount_asset },
    status: row.status,
    createdAt: iso(row.created_at),
    ...(row.note !== null ? { note: row.note } : {}),
    ...(row.settled_at !== null ? { settledAt: iso(row.settled_at) } : {}),
    ...(row.ref !== null ? { ref: row.ref } : {}),
  };
}
