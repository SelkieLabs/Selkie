import { randomUUID } from "node:crypto";
import { orNull, orUndefined, transact, type Db } from "../db/open";
import { IdentityAlreadyLinkedError, UserNotFoundError, type UserStore } from "./store";
import { identityKey, type IdentityProviderId, type LinkedIdentity, type User } from "./types";

interface UserRow {
  id: string;
  address: string;
  created_at: string;
}

interface IdentityRow {
  provider: string;
  subject: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
  linked_at: string;
}

/**
 * Users, on disk.
 *
 * Same behaviour as `InMemoryUserStore`, same tests, and one difference that
 * matters: the "an identity belongs to exactly one account" rule is enforced by
 * a primary key rather than by a Map, so it survives a restart and a race.
 */
export class SqliteUserStore implements UserStore {
  constructor(private readonly db: Db) {}

  async create(user: Omit<User, "id" | "createdAt">): Promise<User> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    // One transaction: a user with no identities is an account nobody can ever
    // sign back into.
    transact(this.db, () => {
      this.db
        .prepare("INSERT INTO users (id, address, created_at) VALUES (?, ?, ?)")
        .run(id, user.address, createdAt);
      for (const identity of user.identities) this.#insertIdentity(id, identity);
    });

    return (await this.get(id))!;
  }

  async get(id: string): Promise<User | null> {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | UserRow
      | undefined;
    return row ? this.#hydrate(row) : null;
  }

  async findByIdentity(provider: IdentityProviderId, subject: string): Promise<User | null> {
    const row = this.db
      .prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?")
      .get(provider, subject) as { user_id: string } | undefined;
    return row ? this.get(row.user_id) : null;
  }

  /**
   * Whoever currently owns a username on a platform. Case-insensitive, because
   * people type handles the way they remember them, not the way they were
   * registered.
   */
  async findByHandle(provider: IdentityProviderId, username: string): Promise<User | null> {
    const row = this.db
      .prepare(
        "SELECT user_id FROM identities WHERE provider = ? AND lower(username) = lower(?) LIMIT 1",
      )
      .get(provider, username) as { user_id: string } | undefined;
    return row ? this.get(row.user_id) : null;
  }

  async addIdentity(userId: string, identity: LinkedIdentity): Promise<User> {
    if (!(await this.get(userId))) throw new UserNotFoundError(userId);

    const owner = this.db
      .prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?")
      .get(identity.provider, identity.subject) as { user_id: string } | undefined;

    if (owner && owner.user_id !== userId) {
      throw new IdentityAlreadyLinkedError(
        identityKey(identity.provider, identity.subject),
        owner.user_id,
      );
    }

    // Re-linking the same identity refreshes it rather than duplicating, which
    // is how a renamed X handle gets picked up.
    this.#insertIdentity(userId, identity);
    return (await this.get(userId))!;
  }

  async removeIdentity(
    userId: string,
    provider: IdentityProviderId,
    subject: string,
  ): Promise<User> {
    const user = await this.get(userId);
    if (!user) throw new UserNotFoundError(userId);

    this.db
      .prepare("DELETE FROM identities WHERE provider = ? AND subject = ? AND user_id = ?")
      .run(provider, subject, userId);
    return (await this.get(userId))!;
  }

  async delete(id: string): Promise<void> {
    // Identities and provider accounts go with it: the foreign keys cascade.
    this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
  }

  async linkProviderAccount(userId: string, subject: string): Promise<void> {
    if (!(await this.get(userId))) throw new UserNotFoundError(userId);
    this.db
      .prepare(
        `INSERT INTO provider_accounts (subject, user_id) VALUES (?, ?)
         ON CONFLICT (subject) DO UPDATE SET user_id = excluded.user_id`,
      )
      .run(subject, userId);
  }

  async findByProviderAccount(subject: string): Promise<User | null> {
    const row = this.db
      .prepare("SELECT user_id FROM provider_accounts WHERE subject = ?")
      .get(subject) as { user_id: string } | undefined;
    return row ? this.get(row.user_id) : null;
  }

  async repointProviderAccounts(fromUserId: string, toUserId: string): Promise<void> {
    this.db
      .prepare("UPDATE provider_accounts SET user_id = ? WHERE user_id = ?")
      .run(toUserId, fromUserId);
  }

  #insertIdentity(userId: string, identity: LinkedIdentity): void {
    this.db
      .prepare(
        `INSERT INTO identities
           (provider, subject, user_id, username, display_name, avatar_url, email, linked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (provider, subject) DO UPDATE SET
           user_id      = excluded.user_id,
           username     = excluded.username,
           display_name = excluded.display_name,
           avatar_url   = excluded.avatar_url,
           email        = excluded.email,
           linked_at    = excluded.linked_at`,
      )
      .run(
        identity.provider,
        identity.subject,
        userId,
        orNull(identity.username),
        orNull(identity.displayName),
        orNull(identity.avatarUrl),
        orNull(identity.email),
        identity.linkedAt,
      );
  }

  #hydrate(row: UserRow): User {
    const identities = this.db
      // Insertion order, and ON CONFLICT UPDATE keeps a refreshed row where it
      // was. The first handle is the one payments are sent FROM, so it must not
      // move just because somebody signed in again.
      .prepare("SELECT * FROM identities WHERE user_id = ? ORDER BY rowid")
      .all(row.id) as unknown as IdentityRow[];

    return {
      id: row.id,
      address: row.address,
      createdAt: row.created_at,
      identities: identities.map((identity) => ({
        provider: identity.provider as IdentityProviderId,
        subject: identity.subject,
        username: orUndefined(identity.username),
        displayName: orUndefined(identity.display_name),
        avatarUrl: orUndefined(identity.avatar_url),
        email: orUndefined(identity.email),
        linkedAt: identity.linked_at,
      })),
    };
  }
}
