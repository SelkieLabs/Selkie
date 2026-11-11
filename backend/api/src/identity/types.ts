import type { HandleRef } from "@selkie/core";

/**
 * Selkie's account model.
 *
 * One person is one User with one wallet and a LIST of identities. That list is
 * the whole design: it is why someone can arrive through Google and later become
 * payable at their X handle without ending up with two wallets, and why adding
 * Telegram later touches nothing here.
 *
 * Identities do two different jobs, and conflating them is the mistake that
 * makes these systems confusing:
 *
 *  - a DOOR you log in through (Google, X, Telegram)
 *  - an ADDRESS people can send money to (X, Telegram)
 *
 * Google is only a door. Nobody sends money to a Gmail address. X and Telegram
 * are both, which is why linking one is not a settings-page nicety: it is the
 * proof of ownership that releases escrowed money.
 */
export type IdentityProviderId = "google" | "x" | "telegram";

/** Providers whose identity is also a payable handle. */
export const PAYABLE_PROVIDERS = ["x", "telegram"] as const;

export function isPayable(provider: IdentityProviderId): boolean {
  return (PAYABLE_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * What a provider is actually vouching for.
 *
 * These are not the same claim, and treating them as one is how money gets
 * taken.
 *
 *  - "login": this person proved they control the account, just now, by signing
 *    in. It is the only thing strong enough to create a wallet or to attach a
 *    handle to one, because attaching a handle releases whatever the escrow has
 *    been holding for it.
 *  - "authorship": a platform said this account wrote this message. Plenty to
 *    act on an instruction from someone who already has an account. Not proof of
 *    ownership, because the bot is asserting it on their behalf and a leaked bot
 *    secret would otherwise be a way to claim any handle's waiting money.
 */
export type Attestation = "login" | "authorship";

/**
 * A verified identity, as returned by an identity provider after a real login.
 * Never constructed from user input.
 */
export interface VerifiedIdentity {
  provider: IdentityProviderId;
  /** How this was proven. Required, because a default here would be a guess. */
  attestation: Attestation;
  /**
   * The provider's permanent id for this person. For X this is the numeric user
   * id, NOT the @handle: handles get renamed and re-registered, and keying on
   * the string would eventually hand someone else's money to a stranger.
   */
  subject: string;
  /** Current username, when the provider has one. Display and payment routing. */
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  email?: string;
}

/** A verified identity that has been attached to a user. */
export interface LinkedIdentity extends VerifiedIdentity {
  linkedAt: string;
}

export interface User {
  id: string;
  /** Stellar address. Present from sign-up; the ledger entry appears lazily. */
  address: string;
  identities: LinkedIdentity[];
  createdAt: string;
}

/** The handle an identity represents, if it is payable at all. */
export function identityHandle(identity: VerifiedIdentity): HandleRef | null {
  if (!isPayable(identity.provider) || !identity.username) return null;
  return { platform: identity.provider, username: identity.username.toLowerCase() };
}

/** Every handle a user can be paid at. */
export function userHandles(user: User): HandleRef[] {
  return user.identities
    .map(identityHandle)
    .filter((handle): handle is HandleRef => handle !== null);
}

export function identityKey(provider: IdentityProviderId, subject: string): string {
  return `${provider}:${subject}`;
}

/**
 * Whether these identities are proof of ownership, as opposed to proof that
 * somebody sent a message. Only the former may create or claim an account.
 */
export function provesOwnership(identities: VerifiedIdentity[]): boolean {
  return (
    identities.length > 0 && identities.every((identity) => identity.attestation === "login")
  );
}
