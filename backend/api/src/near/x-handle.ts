import type { HandleRef } from "@selkie/core";
import { toHandle } from "../app";

/**
 * X usernames are 1 to 15 letters, numbers or underscores. Anything else, such
 * as a NEAR account pasted into the handle box, is not one, and money held in
 * the escrow for it could never be claimed: no X account can sign in under
 * that name. So it is refused before anything is signed.
 */
export const X_USERNAME = /^[a-z0-9_]{1,15}$/;

/** A typed X handle ("@Amaka", "amaka"), or null when it cannot be an X username. */
export function toXHandle(input: string): HandleRef | null {
  const handle = toHandle(input, "x");
  return handle && X_USERNAME.test(handle.username) ? handle : null;
}

/** Why a typed handle was refused, in words that say what to do instead. */
export function notAnXHandle(input: string): string {
  const typed = input.trim().replace(/^@+/, "");
  if (!typed) return "Add the handle you want to pay.";
  if (typed.includes(".")) return "That is a NEAR account, not an X username. Pay it as an address instead.";
  return "That is not an X username. They are up to 15 letters, numbers or underscores.";
}
