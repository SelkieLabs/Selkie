import { randomUUID } from "node:crypto";
import { iso, type Queryable } from "../db/pool";
import type { BotSendRecord, BotSendResult, BotSendStore } from "./pocket";
import type { NearAccountRecord, NearAccountStore, PrepareRecord, PrepareStore } from "./store";

export class PostgresBotSendStore implements BotSendStore {
  constructor(private readonly db: Queryable) {}

  async begin(tweetId: string, senderXUserId: string): Promise<BotSendRecord | null> {
    // One statement claims the tweet: of two calls racing for it, exactly one
    // gets a row back and goes on to pay.
    const claimed = await this.db.query(
      `insert into near_bot_sends (tweet_id, sender_x_user_id) values ($1, $2)
         on conflict (tweet_id) do nothing returning tweet_id`,
      [tweetId, senderXUserId],
    );
    if (claimed.rows.length > 0) return null;
    const { rows } = await this.db.query<{ sender_x_user_id: string; result: string | null }>(
      "select sender_x_user_id, result from near_bot_sends where tweet_id = $1",
      [tweetId],
    );
    const row = rows[0];
    // Not ours to claim either way; never read as "go ahead and pay".
    if (!row) return { senderXUserId: "", result: null };
    return { senderXUserId: row.sender_x_user_id, result: row.result ? (JSON.parse(row.result) as BotSendResult) : null };
  }

  async finish(tweetId: string, result: BotSendResult): Promise<void> {
    await this.db.query("update near_bot_sends set result = $2, finished_at = now() where tweet_id = $1", [
      tweetId,
      JSON.stringify(result),
    ]);
  }
}

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
      `insert into near_accounts (x_user_id, account_id, public_key, seen_usdc) values ($1, $2, $3, 0) returning *`,
      [record.xUserId, record.accountId, record.publicKey],
    );
    return toAccount(rows[0]!);
  }

  async seenUsdc(accountId: string) {
    const { rows } = await this.db.query<{ seen_usdc: string | null }>(
      "select seen_usdc::text from near_accounts where account_id = $1",
      [accountId],
    );
    const seen = rows[0]?.seen_usdc;
    return seen === null || seen === undefined ? null : BigInt(seen);
  }

  async startSeenUsdc(accountId: string, units: bigint) {
    await this.db.query("update near_accounts set seen_usdc = $2 where account_id = $1 and seen_usdc is null", [
      accountId,
      units.toString(),
    ]);
  }

  async addSeenUsdc(accountId: string, delta: bigint) {
    // One statement, so two payments settling at once both count.
    await this.db.query(
      "update near_accounts set seen_usdc = seen_usdc + $2 where account_id = $1 and seen_usdc is not null",
      [accountId, delta.toString()],
    );
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
