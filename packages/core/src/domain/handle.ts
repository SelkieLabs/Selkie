import type { HandleRef } from "../chains/types";

/** Turn "@Name" or "name" on a platform into a normalized handle. */
export function parseHandle(input: string, platform: HandleRef["platform"]): HandleRef {
  const username = input.trim().replace(/^@+/, "").toLowerCase();
  if (!username) throw new Error("Empty handle");
  return { platform, username };
}

/** A stable key for a handle, safe to use as a map key or storage id. */
export function handleKey(handle: HandleRef): string {
  return `${handle.platform}:${handle.username}`;
}

/** Display form, e.g. "@martin". */
export function formatHandle(handle: HandleRef): string {
  return `@${handle.username}`;
}

export function handlesEqual(a: HandleRef, b: HandleRef): boolean {
  return handleKey(a) === handleKey(b);
}

/**
 * The on-chain form of a handle: sha256 of the handle key, e.g. sha256("x:amaka").
 *
 * This is a protocol constant, not an implementation detail. It must stay
 * byte-identical to what the escrow contract stores, or money deposited for a
 * handle can never be found again. Any chain that escrows by handle uses this
 * same hash, which is why it lives in core rather than in an adapter.
 *
 * Pseudonymity, not secrecy: anyone can hash a handle they already know and look
 * it up. Selkie does not claim otherwise.
 */
export async function handleHash(handle: HandleRef): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(handleKey(handle));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

/** The handle hash as lowercase hex, the form used in APIs and logs. */
export async function handleHashHex(handle: HandleRef): Promise<string> {
  const hash = await handleHash(handle);
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}
