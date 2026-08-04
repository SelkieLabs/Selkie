"use client";

import { useSyncExternalStore } from "react";

const KEY = "selkie:amounts-hidden";

/**
 * Whether amounts are hidden right now.
 *
 * Module state rather than a context, because two components far apart in the
 * tree have to agree: the toggle lives on the balance card, and the list of
 * assets underneath it would otherwise keep showing the number the toggle just
 * hid. Someone covering their balance on a train has not been helped if half
 * the screen ignores them.
 *
 * Remembered across visits. A privacy setting that resets on every page load is
 * not a privacy setting.
 */
let hidden = false;
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    // Private browsing and blocked storage both throw. Not remembering the
    // preference is survivable; crashing the wallet is not.
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) hidden = read();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function toggleAmountsHidden(): void {
  hidden = !hidden;
  try {
    window.localStorage.setItem(KEY, hidden ? "1" : "0");
  } catch {
    // Preference not saved, but the toggle still works for this session.
  }
  for (const listener of listeners) listener();
}

/**
 * Server-rendered markup always shows amounts, and the client corrects it on
 * hydration. Returning the stored value here instead would make the two disagree
 * and React would throw a hydration error.
 */
const serverSnapshot = () => false;

export function useAmountsHidden(): boolean {
  return useSyncExternalStore(subscribe, () => hidden, serverSnapshot);
}

/** What a hidden number looks like. Wide enough to read as deliberate. */
export const MASK = "••••";
