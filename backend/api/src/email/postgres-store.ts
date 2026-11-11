import type { Pool } from "pg";
import type { EmailRecord, EmailStore } from "./store";

interface Row {
  user_id: string;
  email: string;
  verified_at: Date | null;
  code_hash: string | null;
  code_expires_at: Date | null;
  code_attempts: number;
  code_sent_at: Date | null;
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

export class PostgresEmailStore implements EmailStore {
  constructor(private readonly db: Pool) {}

  async get(userId: string): Promise<EmailRecord | null> {
    const { rows } = await this.db.query<Row>("select * from notify_emails where user_id = $1", [userId]);
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      email: row.email,
      verifiedAt: iso(row.verified_at),
      codeHash: row.code_hash,
      codeExpiresAt: iso(row.code_expires_at),
      codeAttempts: row.code_attempts,
      codeSentAt: iso(row.code_sent_at),
    };
  }

  async startVerification(userId: string, email: string, codeHash: string, expiresAt: string, sentAt: string) {
    await this.db.query(
      `insert into notify_emails (user_id, email, code_hash, code_expires_at, code_sent_at)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id) do update set
         email = excluded.email, verified_at = null, code_hash = excluded.code_hash,
         code_expires_at = excluded.code_expires_at, code_attempts = 0, code_sent_at = excluded.code_sent_at`,
      [userId, email, codeHash, expiresAt, sentAt],
    );
  }

  async failedAttempt(userId: string) {
    const { rows } = await this.db.query<{ code_attempts: number }>(
      "update notify_emails set code_attempts = code_attempts + 1 where user_id = $1 returning code_attempts",
      [userId],
    );
    return rows[0]?.code_attempts ?? 0;
  }

  async confirm(userId: string, at: string) {
    await this.db.query(
      `update notify_emails set verified_at = $2, code_hash = null, code_expires_at = null, code_attempts = 0
       where user_id = $1`,
      [userId, at],
    );
  }

  async remove(userId: string) {
    await this.db.query("delete from notify_emails where user_id = $1", [userId]);
  }
}
