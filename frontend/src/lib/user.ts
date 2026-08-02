import type { User } from "./api";

/**
 * How an account presents itself.
 *
 * One person can have several identities behind one wallet, so "your name" is a
 * choice rather than a field: the first identity that has a real name wins, and
 * a handle stands in when none does.
 */
export function displayNameOf(user: User): string {
  const named = user.identities.find((identity) => identity.displayName);
  if (named?.displayName) return named.displayName;
  const handle = user.handles[0];
  return handle ? `@${handle.username}` : "Your wallet";
}

export function avatarOf(user: User): string | undefined {
  return user.identities.find((identity) => identity.avatarUrl)?.avatarUrl;
}

/** The handle people pay them at, or their name when they have not linked one. */
export function handleOf(user: User): string {
  const handle = user.handles[0];
  return handle ? `@${handle.username}` : displayNameOf(user);
}
