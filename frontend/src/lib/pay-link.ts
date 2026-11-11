/**
 * A payment someone was handed as a link: `selkiepay.com/pay/amaka?amount=5`.
 *
 * The X bot answers "send 5 to @amaka" with one, because on NEAR only the
 * person's own key can sign. The link must survive a sign-in on the way (the
 * wallet sends signed-out visitors to the front page, and X's login can leave
 * the tab), so it is kept in this browser for a short while and picked up by
 * Send or Requests when they open.
 *
 * Nothing here moves money. It fills in a form, and the person still checks
 * the confirm screen and signs.
 */

export type PayLinkKind = "pay" | "ask";

export interface PayLink {
  kind: PayLinkKind;
  /** The X handle to pay, or to ask, without the @. */
  handle: string;
  /** A decimal string, or empty when the link did not say. */
  amount: string;
  note: string;
}

const KEY = "selkie.pay-link";
/** Long enough for a sign-in, short enough that an old link does not ambush a later visit. */
const KEEP_MS = 30 * 60 * 1000;
/** X's own rule for a username. */
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const AMOUNT = /^\d{1,9}(\.\d{1,6})?$/;
const NOTE_MAX = 120;

/** Read a link's parts, keeping only what is well formed. Null when there is no handle. */
export function readPayLink(kind: PayLinkKind, rawHandle: string, params: URLSearchParams): PayLink | null {
  let handle: string;
  try {
    handle = decodeURIComponent(rawHandle).trim().replace(/^@+/, "");
  } catch {
    return null; // a broken %-escape: not a handle anyone typed
  }
  if (!HANDLE.test(handle)) return null;
  const amount = (params.get("amount") ?? "").trim();
  return {
    kind,
    handle: handle.toLowerCase(),
    amount: AMOUNT.test(amount) && Number(amount) > 0 ? amount : "",
    note: (params.get("note") ?? "").trim().slice(0, NOTE_MAX),
  };
}

export function savePayLink(link: PayLink): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...link, at: Date.now() }));
  } catch {
    // Private mode or blocked storage: the link still opens the right screen,
    // just without the form filled in.
  }
}

/** The waiting link of this kind, once: reading it clears it. */
export function takePayLink(kind: PayLinkKind): PayLink | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as PayLink & { at?: number };
    if (stored.kind !== kind) return null;
    localStorage.removeItem(KEY);
    if (typeof stored.at !== "number" || Date.now() - stored.at > KEEP_MS) return null;
    return { kind, handle: stored.handle, amount: stored.amount, note: stored.note };
  } catch {
    return null;
  }
}
