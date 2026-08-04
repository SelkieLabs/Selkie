import type { HandleRef, Money } from "@selkie/core";
import type { StellarAdapter } from "@selkie/chain-stellar";
import type { IdentityProvider } from "./provider";
import type { UserStore } from "./store";
import { IdentityAlreadyLinkedError } from "./store";
import type { IdentityProviderId, LinkedIdentity, User, VerifiedIdentity } from "./types";
import { identityHandle, isPayable, userHandles } from "./types";

/**
 * The account model in one place: signing in, linking a handle, releasing money
 * that was waiting, and merging two accounts that turn out to be one person.
 *
 * The rule that drives all of it: a user is never silently created and never
 * silently merged. Both of those are one deliberate tap in the UI, because a
 * money app that guesses about identity is a money app that loses money.
 */

export interface SignInResult {
  user: User;
  /** True when this login created the account, which the UI confirms first. */
  isNew: boolean;
  /** Money that was waiting for a handle and just became theirs. */
  claimed: ClaimOutcome[];
}

export interface ClaimOutcome {
  handle: HandleRef;
  /** How many separate payments were waiting. */
  released: number;
  /** What they came to, totalled per asset. This is the number the user sees. */
  amounts: Money[];
  /**
   * The escrow ids that were released.
   *
   * Read before claiming, because the contract deletes them on the way out.
   * The senders of these payments still have them marked "waiting", and this is
   * the only thing that connects their side of the story to this one.
   */
  paymentIds: string[];
  ref?: string;
}

export interface LinkResult {
  status: "linked" | "merge-required";
  user: User;
  claimed: ClaimOutcome[];
  /** Set when the identity already belongs to another account. */
  mergeCandidate?: { userId: string; address: string };
}

export class IdentityService {
  constructor(
    private readonly deps: {
      users: UserStore;
      provider: IdentityProvider;
      adapter: StellarAdapter;
    },
  ) {}

  /**
   * Sign in, creating the account only when asked to.
   *
   * An identity we have never seen does NOT silently become a new account. That
   * is the single most common way these systems give one person two wallets: they
   * sign up with Google, come back later, tap "continue with X", and quietly get
   * a second account with their money in the wrong one. Instead the caller gets
   * `isNew: false` and no user, and the UI asks once.
   */
  async signIn(token: string, options: { createIfMissing: boolean }): Promise<SignInResult | null> {
    const identities = await this.deps.provider.verify(token);

    const existing = await this.#findExistingUser(identities);
    if (existing) {
      // A returning user may have linked more accounts at the provider since
      // last time, so fold in anything new and see if money is waiting.
      const user = await this.#syncIdentities(existing, identities);
      const claimed = await this.claimWaitingMoney(user);
      return { user, isNew: false, claimed };
    }

    if (!options.createIfMissing) return null;

    const address = await this.#addressFor(token, identities);
    const created = await this.deps.users.create({
      address,
      identities: identities.map(stamp),
    });
    const claimed = await this.claimWaitingMoney(created);
    return { user: created, isNew: true, claimed };
  }

  /**
   * Attach another identity to an account that is already signed in.
   *
   * This is the moment the product hinges on. Linking an X account proves the
   * handle belongs to this person, which is exactly the proof the escrow needs,
   * so anything waiting for that handle lands in their wallet immediately.
   */
  async link(userId: string, token: string): Promise<LinkResult> {
    const user = await this.#requireUser(userId);
    const identities = await this.deps.provider.verify(token);

    for (const identity of identities) {
      const owner = await this.deps.users.findByIdentity(identity.provider, identity.subject);
      if (owner && owner.id !== userId) {
        // Two accounts, one person. Never merge without asking: it moves money.
        return {
          status: "merge-required",
          user,
          claimed: [],
          mergeCandidate: { userId: owner.id, address: owner.address },
        };
      }
    }

    const updated = await this.#syncIdentities(user, identities);
    const claimed = await this.claimWaitingMoney(updated);
    return { status: "linked", user: updated, claimed };
  }

  /**
   * Fold `fromUserId` into `intoUserId`: move the money, move the identities,
   * close the empty account. Only ever called after the user confirms.
   */
  async merge(intoUserId: string, fromUserId: string): Promise<User> {
    if (intoUserId === fromUserId) return this.#requireUser(intoUserId);
    const into = await this.#requireUser(intoUserId);
    const from = await this.#requireUser(fromUserId);

    // Sweep first. If this fails the merge does not happen, so money is never
    // stranded in an account we just deleted.
    await this.#sweep(from, into);

    for (const identity of from.identities) {
      await this.deps.users.removeIdentity(from.id, identity.provider, identity.subject);
      await this.deps.users.addIdentity(into.id, identity);
    }
    await this.deps.users.delete(from.id);

    const merged = await this.#requireUser(into.id);
    // Whatever was waiting for the newly attached handles is theirs now.
    await this.claimWaitingMoney(merged);
    return this.#requireUser(into.id);
  }

  /** Release everything the escrow is holding for any handle this user owns. */
  async claimWaitingMoney(user: User): Promise<ClaimOutcome[]> {
    const outcomes: ClaimOutcome[] = [];
    for (const handle of userHandles(user)) {
      const pending = await this.deps.adapter.pendingClaims(handle);
      if (pending.length === 0) continue;

      // Read the amounts before claiming. Claiming deletes the records that
      // hold them, and "$25 was waiting for you" is the whole moment.
      const amounts = await this.deps.adapter.waitingFor(handle);
      const result = await this.deps.adapter.claim(handle);
      outcomes.push({
        handle,
        released: pending.length,
        amounts,
        paymentIds: pending.map(String),
        ref: result.ref,
      });
    }
    return outcomes;
  }

  /** Who should receive a payment addressed to this handle, if anyone yet. */
  async findByHandle(provider: IdentityProviderId, username: string): Promise<User | null> {
    return this.deps.users.findByHandle(provider, username);
  }

  async #findExistingUser(identities: VerifiedIdentity[]): Promise<User | null> {
    for (const identity of identities) {
      const user = await this.deps.users.findByIdentity(identity.provider, identity.subject);
      if (user) return user;
    }
    return null;
  }

  /**
   * Attach any identities this user does not have yet, and refresh the ones they
   * do. Refreshing matters: X handles get renamed, and a stale username would
   * route payments to a handle this person no longer owns.
   */
  async #syncIdentities(user: User, identities: VerifiedIdentity[]): Promise<User> {
    let current = user;
    for (const identity of identities) {
      try {
        current = await this.deps.users.addIdentity(current.id, stamp(identity));
      } catch (error) {
        if (error instanceof IdentityAlreadyLinkedError) continue;
        throw error;
      }
    }
    return current;
  }

  /** Move everything from one wallet to another during a merge. */
  async #sweep(from: User, into: User): Promise<void> {
    const balance = await this.deps.adapter.getBalance({
      chain: "stellar",
      handle: { platform: "x", username: from.id },
      address: from.address,
      status: "active",
    });

    for (const money of balance.balances) {
      if (Number(money.amount) <= 0) continue;
      await this.deps.adapter.transfer({
        fromAddress: from.address,
        toAddress: into.address,
        amount: money,
      });
    }
  }

  async #addressFor(token: string, identities: VerifiedIdentity[]): Promise<string> {
    const managed = await this.deps.provider.walletAddress?.(token);
    if (managed) return managed;

    // No provider-managed wallet, so Selkie provisions one against the first
    // payable handle. Falls back to the provider subject when someone signs up
    // with Google alone and has nothing payable yet.
    const payable = identities.find((identity) => isPayable(identity.provider));
    const handle = payable
      ? identityHandle(payable)
      : { platform: identities[0]!.provider, username: identities[0]!.subject };
    const account = await this.deps.adapter.ensureAccount(handle as HandleRef);
    return account.address;
  }

  async #requireUser(id: string): Promise<User> {
    const user = await this.deps.users.get(id);
    if (!user) throw new Error(`No such user: ${id}`);
    return user;
  }
}

function stamp(identity: VerifiedIdentity): LinkedIdentity {
  return { ...identity, linkedAt: new Date().toISOString() };
}
