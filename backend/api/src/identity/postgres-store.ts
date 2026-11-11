import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { inTransaction, iso, type Queryable } from "../db/pool";
import type { IdentityProviderId, LinkedIdentity, User } from "./types";
import { IdentityAlreadyLinkedError, UserNotFoundError, type UserStore } from "./store";

/**
 * Users, in Postgres.
 *
 * The interesting part is not that the rows are durable. It is that the account
 * model is now enforced by the database rather than by a Map: `identities` has
 * `(provider, subject)` as its primary key, so an X account belonging to two
 * Selkie wallets is not a bug that can happen and then be found later. The
 * insert fails.
 */

/** Identities come back from Postgres as JSON, already in the shape below. */
interface RawIdentity {
  provider: IdentityProviderId;
  subject: string;
  attestation: "login" | "authorship";
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  linkedAt: string;
}

interface RawUser {
  id: string;
  address: string;
  created_at: Date | string;
  identities: RawIdentity[];
}

/**
 * One round trip for a user and everything attached to them.
 *
 * Built as JSON in the database rather than joined and stitched together here,
 * because the alternative is either a second query per user or de-duplicating
 * repeated user columns by hand, and both of those get quietly wrong.
 */
const SELECT_USER = `
  select
    u.id,
    u.address,
    u.created_at,
    coalesce(
      json_agg(
        json_build_object(
          'provider',    i.provider,
          'subject',     i.subject,
          'attestation', i.attestation,
          'username',    i.username,
          'displayName', i.display_name,
          'avatarUrl',   i.avatar_url,
          'email',       i.email,
          'linkedAt',    i.linked_at
        ) order by i.linked_at
      ) filter (where i.provider is not null),
      '[]'
    ) as identities
  from users u
  left join identities i on i.user_id = u.id
`;

export class PostgresUserStore implements UserStore {
  readonly #db: Queryable;
  readonly #pool: Pool | null;

  /**
   * Takes a pool, or a transaction when a caller needs this to land together
   * with something else. Only the pool form can start transactions of its own,
   * which is why both are held.
   */
  constructor(db: Pool | Queryable) {
    this.#db = db;
    this.#pool = isPool(db) ? db : null;
  }

  async create(user: Omit<User, "id" | "createdAt">): Promise<User> {
    const id = randomUUID();

    // The user and their identities go in together. A user row with no way to
    // sign in is an account nobody can ever reach, and an identity pointing at
    // a user that does not exist is a foreign key violation waiting to happen.
    const run = async (tx: Queryable) => {
      await tx.query("insert into users (id, address) values ($1, $2)", [id, user.address]);
      for (const identity of user.identities) await insertIdentity(tx, id, identity);
    };

    if (this.#pool) await inTransaction(this.#pool, run);
    else await run(this.#db);

    const created = await this.get(id);
    if (!created) throw new UserNotFoundError(id);
    return created;
  }

  async get(id: string): Promise<User | null> {
    return this.#one(`${SELECT_USER} where u.id = $1 group by u.id`, [id]);
  }

  async findByIdentity(provider: IdentityProviderId, subject: string): Promise<User | null> {
    return this.#one(
      `${SELECT_USER}
       where u.id = (select user_id from identities where provider = $1 and subject = $2)
       group by u.id`,
      [provider, subject],
    );
  }

  /**
   * Who currently owns a username on a platform.
   *
   * Case-insensitive, because @Amaka and @amaka are one X account.
   *
   * Newest link wins where two identities claim the same name. Handles get
   * released and re-registered, so an old row can still carry a name somebody
   * else now holds, and the one that was proven most recently is the one with
   * a live login behind it.
   */
  async findByHandle(provider: IdentityProviderId, username: string): Promise<User | null> {
    return this.#one(
      `${SELECT_USER}
       where u.id = (
         select user_id from identities
         where provider = $1 and lower(username) = lower($2)
         order by linked_at desc
         limit 1
       )
       group by u.id`,
      [provider, username],
    );
  }

  async addIdentity(userId: string, identity: LinkedIdentity): Promise<User> {
    const { rows } = await this.#db.query<{ user_id: string }>(
      "select user_id from identities where provider = $1 and subject = $2",
      [identity.provider, identity.subject],
    );
    const owner = rows[0]?.user_id;
    if (owner && owner !== userId) {
      throw new IdentityAlreadyLinkedError(`${identity.provider}:${identity.subject}`, owner);
    }

    await insertIdentity(this.#db, userId, identity);

    const user = await this.get(userId);
    if (!user) throw new UserNotFoundError(userId);
    return user;
  }

  async removeIdentity(
    userId: string,
    provider: IdentityProviderId,
    subject: string,
  ): Promise<User> {
    // Scoped to the user on purpose. Without the user_id here, anyone able to
    // name an identity could detach it from somebody else's account.
    await this.#db.query(
      "delete from identities where user_id = $1 and provider = $2 and subject = $3",
      [userId, provider, subject],
    );

    const user = await this.get(userId);
    if (!user) throw new UserNotFoundError(userId);
    return user;
  }

  async delete(id: string): Promise<void> {
    // Identities go with them, by the foreign key's on delete cascade.
    await this.#db.query("delete from users where id = $1", [id]);
  }

  async #one(sql: string, values: unknown[]): Promise<User | null> {
    const { rows } = await this.#db.query<RawUser>(sql, values);
    const row = rows[0];
    return row ? toUser(row) : null;
  }
}

/**
 * Linking the same identity again refreshes it rather than duplicating it.
 * This is how a renamed X handle gets picked up: same subject, new username.
 */
async function insertIdentity(db: Queryable, userId: string, identity: LinkedIdentity): Promise<void> {
  await db.query(
    `insert into identities
       (provider, subject, user_id, username, display_name, avatar_url, email, attestation, linked_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (provider, subject) do update set
       user_id      = excluded.user_id,
       username     = excluded.username,
       display_name = excluded.display_name,
       avatar_url   = excluded.avatar_url,
       email        = excluded.email,
       attestation  = excluded.attestation,
       linked_at    = excluded.linked_at`,
    [
      identity.provider,
      identity.subject,
      userId,
      identity.username ?? null,
      identity.displayName ?? null,
      identity.avatarUrl ?? null,
      identity.email ?? null,
      identity.attestation,
      identity.linkedAt,
    ],
  );
}

function toUser(row: RawUser): User {
  return {
    id: row.id,
    address: row.address,
    createdAt: iso(row.created_at),
    identities: row.identities.map(toIdentity),
  };
}

/**
 * Absent columns come back as null and have to leave as absent, not as an
 * explicit undefined: `exactOptionalPropertyTypes` treats those as different,
 * and it is right to, because `{ username: undefined }` claims there is a
 * username field and it is empty.
 */
function toIdentity(raw: RawIdentity): LinkedIdentity {
  return {
    provider: raw.provider,
    subject: raw.subject,
    attestation: raw.attestation,
    linkedAt: new Date(raw.linkedAt).toISOString(),
    ...(raw.username !== null ? { username: raw.username } : {}),
    ...(raw.displayName !== null ? { displayName: raw.displayName } : {}),
    ...(raw.avatarUrl !== null ? { avatarUrl: raw.avatarUrl } : {}),
    ...(raw.email !== null ? { email: raw.email } : {}),
  };
}

function isPool(db: Pool | Queryable): db is Pool {
  return typeof (db as Pool).connect === "function";
}
