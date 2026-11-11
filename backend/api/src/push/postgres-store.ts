import type { Pool } from "pg";
import { MAX_SUBSCRIPTIONS_PER_USER, type PushStore, type PushSubscriptionRecord } from "./store";

interface Row {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
}

export class PostgresPushStore implements PushStore {
  constructor(private readonly db: Pool) {}

  async save(record: PushSubscriptionRecord) {
    await this.db.query(
      `insert into push_subscriptions (endpoint, user_id, p256dh, auth) values ($1, $2, $3, $4)
       on conflict (endpoint) do update
         set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now()`,
      [record.endpoint, record.userId, record.p256dh, record.auth],
    );
    await this.db.query(
      `delete from push_subscriptions where user_id = $1 and endpoint not in (
         select endpoint from push_subscriptions where user_id = $1 order by created_at desc limit $2)`,
      [record.userId, MAX_SUBSCRIPTIONS_PER_USER],
    );
  }

  async forUser(userId: string) {
    const { rows } = await this.db.query<Row>(
      "select endpoint, user_id, p256dh, auth from push_subscriptions where user_id = $1 order by created_at desc",
      [userId],
    );
    return rows.map((row) => ({ endpoint: row.endpoint, userId: row.user_id, p256dh: row.p256dh, auth: row.auth }));
  }

  async remove(endpoint: string, userId?: string) {
    if (userId === undefined) {
      await this.db.query("delete from push_subscriptions where endpoint = $1", [endpoint]);
    } else {
      await this.db.query("delete from push_subscriptions where endpoint = $1 and user_id = $2", [endpoint, userId]);
    }
  }
}
