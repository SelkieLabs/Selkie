import { randomUUID } from "node:crypto";
import type { IdentityProviderId, LinkedIdentity, User } from "./types";
import { identityKey } from "./types";

/**
 * Where users live. An interface because the API server owns this table in
 * Postgres, while tests and the local runner use memory. Nothing above this
 * layer knows the difference.
 */
export interface UserStore {
  create(user: Omit<User, "id" | "createdAt">): Promise<User>;
  get(id: string): Promise<User | null>;
  findByIdentity(provider: IdentityProviderId, subject: string): Promise<User | null>;
  findByHandle(provider: IdentityProviderId, username: string): Promise<User | null>;
  addIdentity(userId: string, identity: LinkedIdentity): Promise<User>;
  removeIdentity(userId: string, provider: IdentityProviderId, subject: string): Promise<User>;
  delete(id: string): Promise<void>;

  /**
   * Remember that this provider account is this user.
   *
   * The fast lane. Every authenticated request proves a provider account id from
   * the token's signature and then comes straight here, with no round trip to
   * anybody.
   */
  linkProviderAccount(userId: string, subject: string): Promise<void>;
  findByProviderAccount(subject: string): Promise<User | null>;
  /**
   * Point every provider account at a different user. Used by a merge.
   *
   * Without this, somebody who merged two accounts could no longer sign in with
   * the login they used first: the id in their token would resolve to a user
   * that no longer exists, and they would be offered a third wallet.
   */
  repointProviderAccounts(fromUserId: string, toUserId: string): Promise<void>;
}

export class UserNotFoundError extends Error {}

export class InMemoryUserStore implements UserStore {
  readonly #users = new Map<string, User>();
  /** identityKey -> userId. Enforces that an identity belongs to one user. */
  readonly #byIdentity = new Map<string, string>();
  /** provider account id -> userId. Many-to-one: a merge leaves two pointing here. */
  readonly #byProviderAccount = new Map<string, string>();

  async create(user: Omit<User, "id" | "createdAt">): Promise<User> {
    const created: User = { ...user, id: randomUUID(), createdAt: new Date().toISOString() };
    this.#users.set(created.id, created);
    for (const identity of created.identities) {
      this.#byIdentity.set(identityKey(identity.provider, identity.subject), created.id);
    }
    return structuredClone(created);
  }

  async get(id: string): Promise<User | null> {
    const user = this.#users.get(id);
    return user ? structuredClone(user) : null;
  }

  async findByIdentity(provider: IdentityProviderId, subject: string): Promise<User | null> {
    const id = this.#byIdentity.get(identityKey(provider, subject));
    return id ? this.get(id) : null;
  }

  /**
   * Find whoever currently owns a username on a platform. Used to route a
   * payment to an existing user, and deliberately case-insensitive.
   */
  async findByHandle(provider: IdentityProviderId, username: string): Promise<User | null> {
    const wanted = username.toLowerCase();
    for (const user of this.#users.values()) {
      const match = user.identities.some(
        (identity) =>
          identity.provider === provider && identity.username?.toLowerCase() === wanted,
      );
      if (match) return structuredClone(user);
    }
    return null;
  }

  async addIdentity(userId: string, identity: LinkedIdentity): Promise<User> {
    const user = this.#users.get(userId);
    if (!user) throw new UserNotFoundError(userId);

    const key = identityKey(identity.provider, identity.subject);
    const owner = this.#byIdentity.get(key);
    if (owner && owner !== userId) {
      throw new IdentityAlreadyLinkedError(key, owner);
    }

    // Re-linking the same identity refreshes it rather than duplicating: this is
    // how a renamed X handle gets picked up.
    //
    // Refreshed IN PLACE, not moved to the end. Every sign-in re-links every
    // identity the provider reports, so appending would reorder this list on
    // each login — and the first entry is the handle payments are sent FROM.
    // Whoever you are paid as should not depend on the order Privy happened to
    // answer in today.
    const at = user.identities.findIndex(
      (existing) =>
        existing.provider === identity.provider && existing.subject === identity.subject,
    );
    if (at === -1) user.identities.push(identity);
    else user.identities[at] = identity;

    this.#byIdentity.set(key, userId);
    return structuredClone(user);
  }

  async removeIdentity(
    userId: string,
    provider: IdentityProviderId,
    subject: string,
  ): Promise<User> {
    const user = this.#users.get(userId);
    if (!user) throw new UserNotFoundError(userId);
    user.identities = user.identities.filter(
      (identity) => !(identity.provider === provider && identity.subject === subject),
    );
    this.#byIdentity.delete(identityKey(provider, subject));
    return structuredClone(user);
  }

  async delete(id: string): Promise<void> {
    const user = this.#users.get(id);
    if (!user) return;
    for (const identity of user.identities) {
      this.#byIdentity.delete(identityKey(identity.provider, identity.subject));
    }
    for (const [subject, owner] of this.#byProviderAccount) {
      if (owner === id) this.#byProviderAccount.delete(subject);
    }
    this.#users.delete(id);
  }

  async linkProviderAccount(userId: string, subject: string): Promise<void> {
    if (!this.#users.has(userId)) throw new UserNotFoundError(userId);
    this.#byProviderAccount.set(subject, userId);
  }

  async findByProviderAccount(subject: string): Promise<User | null> {
    const id = this.#byProviderAccount.get(subject);
    return id ? this.get(id) : null;
  }

  async repointProviderAccounts(fromUserId: string, toUserId: string): Promise<void> {
    for (const [subject, owner] of this.#byProviderAccount) {
      if (owner === fromUserId) this.#byProviderAccount.set(subject, toUserId);
    }
  }
}

export class IdentityAlreadyLinkedError extends Error {
  constructor(
    readonly identity: string,
    readonly ownerId: string,
  ) {
    super(`${identity} is already linked to another Selkie account`);
  }
}
