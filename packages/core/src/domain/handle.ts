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

/**
 * Who a held payment waits for, when the sender's handle resolves to an X user id:
 * sha256("x-id:<numeric id>").
 *
 * Why this exists next to handleHash: an X username is not an identity. People
 * rename, and a released username can be registered by someone else, so money
 * keyed on "x:amaka" pays whoever holds @amaka on the day they sign in, which
 * may not be the person the sender meant. The numeric user id never changes
 * hands. Selkie keys on it whenever it can look the id up (X API), and falls
 * back to handleHash when it cannot; on claim it releases both, so either form
 * pays out to the person who proves the login.
 *
 * Like handleHash, this is a protocol constant: it must stay byte-identical to
 * what the escrow stores.
 */
export async function xIdHash(xUserId: string): Promise<Uint8Array> {
  if (!/^\d{1,20}$/.test(xUserId)) throw new Error(`Not an X user id: ${xUserId}`);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`x-id:${xUserId}`));
  return new Uint8Array(digest);
}

/** The X-id hash as lowercase hex, the form the NEAR escrow stores. */
export async function xIdHashHex(xUserId: string): Promise<string> {
  return toHex(await xIdHash(xUserId));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
