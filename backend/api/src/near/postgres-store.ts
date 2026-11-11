import { randomUUID } from "node:crypto";
import { iso, type Queryable } from "../db/pool";
import type { NearAccountRecord, NearAccountStore, PrepareRecord, PrepareStore } from "./store";

interface AccountRow {
  x_user_id: string;
  account_id: string;
  public_key: string;
  created_at: Date;
}

const toAccount = (row: AccountRow): NearAccountRecord => ({
  xUserId: row.x_user_id,
  accountId: row.account_id,
  publicKey: row.public_key,
  createdAt: iso(row.created_at),
});

export class PostgresNearAccountStore implements NearAccountStore {
  constructor(private readonly db: Queryable) {}

  async findByXUserId(xUserId: string) {
    const { rows } = await this.db.query<AccountRow>("select * from near_accounts where x_user_id = $1", [xUserId]);
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async findByAccountId(accountId: string) {
    const { rows } = await this.db.query<AccountRow>("select * from near_accounts where account_id = $1", [accountId]);
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async insert(record: Omit<NearAccountRecord, "createdAt">) {
    const { rows } = await this.db.query<AccountRow>(
      `insert into near_accounts (x_user_id, account_id, public_key) values ($1, $2, $3) returning *`,
      [record.xUserId, record.accountId, record.publicKey],
    );
    return toAccount(rows[0]!);
  }
}

interface PrepareRow {
  id: string;
  user_id: string;
  delegate: string;
  intent: string;
  expires_at: Date;
}

export class PostgresPrepareStore implements PrepareStore {
  constructor(private readonly db: Queryable) {}

  async create(input: Omit<PrepareRecord, "id">) {
    const id = randomUUID();
    await this.db.query(
      `insert into near_prepares (id, user_id, delegate, intent, expires_at) values ($1, $2, $3, $4, $5)`,
      [id, input.userId, JSON.stringify(input.delegate), JSON.stringify(input.intent), input.expiresAt],
    );
    return { ...input, id };
  }

  async take(id: string, userId: string) {
    // One statement: the row is claimed and returned together, so a second relay
    // of the same signature finds used_at already set and gets nothing.
    const { rows } = await this.db.query<PrepareRow>(
      `update near_prepares set used_at = now()
        where id = $1 and user_id = $2 and used_at is null and expires_at > now()
        returning id, user_id, delegate, intent, expires_at`,
      [id, userId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      delegate: JSON.parse(row.delegate),
      intent: JSON.parse(row.intent),
      expiresAt: iso(row.expires_at),
    };
  }
}
