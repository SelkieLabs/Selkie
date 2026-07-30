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
