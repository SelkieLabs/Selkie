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
  /** Handles on Selkie that start with, or contain, `text`. Best match first. */
  searchHandles(provider: IdentityProviderId, text: string, limit: number): Promise<HandleMatch[]>;
  addIdentity(userId: string, identity: LinkedIdentity): Promise<User>;
  removeIdentity(userId: string, provider: IdentityProviderId, subject: string): Promise<User>;
  delete(id: string): Promise<void>;
}

/** One person the Send box can suggest while a handle is being typed. */
export interface HandleMatch {
  userId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  address?: string;
}

/**
 * How well a handle matches what was typed: the start of the handle beats
 * anywhere in it, which beats the display name. Shorter handles first, since
 * "ama" is more likely @amaka than @amanda_okonkwo_2.
 */
export function rankHandleMatches(matches: HandleMatch[], text: string): HandleMatch[] {
  const wanted = text.toLowerCase();
  const score = (m: HandleMatch) => {
    const name = m.username.toLowerCase();
    return name.startsWith(wanted) ? 0 : name.includes(wanted) ? 1 : 2;
  };
  return [...matches].sort(
    (a, b) => score(a) - score(b) || a.username.length - b.username.length || a.username.localeCompare(b.username),
  );
}

export class UserNotFoundError extends Error {}

export class InMemoryUserStore implements UserStore {
  readonly #users = new Map<string, User>();
  /** identityKey -> userId. Enforces that an identity belongs to one user. */
  readonly #byIdentity = new Map<string, string>();

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

  async searchHandles(provider: IdentityProviderId, text: string, limit: number): Promise<HandleMatch[]> {
    const wanted = text.toLowerCase();
    const found = new Map<string, HandleMatch>();
    for (const user of this.#users.values()) {
      for (const identity of user.identities) {
        if (identity.provider !== provider || !identity.username) continue;
        const name = identity.username.toLowerCase();
        if (!name.includes(wanted) && !(identity.displayName ?? "").toLowerCase().includes(wanted)) continue;
        found.set(name, {
          userId: user.id,
          username: name,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          address: user.address,
        });
      }
    }
    return rankHandleMatches([...found.values()], wanted).slice(0, limit);
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
    user.identities = user.identities.filter(
      (existing) =>
        !(existing.provider === identity.provider && existing.subject === identity.subject),
    );
    user.identities.push(identity);
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
    this.#users.delete(id);
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
