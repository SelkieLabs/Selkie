import { randomUUID } from "node:crypto";
import type { HandleRef } from "@selkie/core";
import { orNull, orUndefined, type Db } from "../db/open";
import type {
  MoneyRequest,
  NewRequest,
  RequestStatus,
  RequestStore,
} from "./store";

interface Row {
  id: string;
  from_user_id: string;
  from_platform: string;
  from_username: string;
  to_platform: string;
  to_username: string;
  amount: string;
  asset: string;
  note: string | null;
  status: string;
  created_at: string;
  settled_at: string | null;
  ref: string | null;
}

/** Asking someone for money, on disk. */
export class SqliteRequestStore implements RequestStore {
  constructor(private readonly db: Db) {}

  async create(input: NewRequest): Promise<MoneyRequest> {
    const request: MoneyRequest = {
      ...input,
      id: `req_${randomUUID()}`,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO requests
           (id, from_user_id, from_platform, from_username, to_platform,
            to_username, amount, asset, note, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        request.id,
        request.fromUserId,
        request.fromHandle.platform,
        request.fromHandle.username,
        request.toHandle.platform,
        request.toHandle.username,
        request.amount.amount,
        request.amount.asset,
        orNull(request.note),
        request.status,
        request.createdAt,
      );

    return request;
  }

  async get(id: string): Promise<MoneyRequest | null> {
    const row = this.db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as Row | undefined;
    return row ? hydrate(row) : null;
  }

  async settle(id: string, status: RequestStatus, ref?: string): Promise<MoneyRequest> {
    const changed = this.db
      .prepare("UPDATE requests SET status = ?, settled_at = ?, ref = COALESCE(?, ref) WHERE id = ?")
      .run(status, new Date().toISOString(), orNull(ref), id);
    if (changed.changes === 0) throw new Error(`No such request: ${id}`);

    return (await this.get(id))!;
  }

  async sentBy(userId: string): Promise<MoneyRequest[]> {
    const rows = this.db
      .prepare("SELECT * FROM requests WHERE from_user_id = ? ORDER BY created_at DESC, rowid DESC")
      .all(userId) as unknown as Row[];
    return rows.map(hydrate);
  }

  /**
   * Requests waiting for any of these handles.
   *
   * Matched case-insensitively on the username, the same way a payment is
   * routed: a request addressed to `@Amaka` is waiting for `@amaka`.
   */
  async addressedTo(handles: HandleRef[]): Promise<MoneyRequest[]> {
    if (handles.length === 0) return [];

    const clause = handles
      .map(() => "(to_platform = ? AND lower(to_username) = lower(?))")
      .join(" OR ");
    const bindings = handles.flatMap((handle) => [handle.platform, handle.username]);

    const rows = this.db
      .prepare(`SELECT * FROM requests WHERE ${clause} ORDER BY created_at DESC, rowid DESC`)
      .all(...bindings) as unknown as Row[];
    return rows.map(hydrate);
  }
}

function hydrate(row: Row): MoneyRequest {
  return {
    id: row.id,
    fromUserId: row.from_user_id,
    fromHandle: {
      platform: row.from_platform as HandleRef["platform"],
      username: row.from_username,
    },
    toHandle: {
      platform: row.to_platform as HandleRef["platform"],
      username: row.to_username,
    },
    amount: { amount: row.amount, asset: row.asset },
    note: orUndefined(row.note),
    status: row.status as RequestStatus,
    createdAt: row.created_at,
    settledAt: orUndefined(row.settled_at),
    ref: orUndefined(row.ref),
  };
}
