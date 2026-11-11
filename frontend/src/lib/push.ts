"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { features } from "@/lib/chain";

/**
 * Notifications when money comes in, with Selkie closed (Web Push).
 *
 * The in-app toast (useArrivals) only works while a tab is open. This asks the
 * browser for a push subscription and hands it to the API, which sends a
 * notification every time money in is written to the person's feed. The
 * message is encrypted to this browser; the push service carrying it (Google,
 * Mozilla, Apple, Microsoft) cannot read it.
 *
 * Opt-in only, from a button: browsers rightly punish sites that ask for
 * notification permission on page load.
 */

export type PushState =
  /** Still finding out. */
  | "checking"
  /** This browser has no Web Push. */
  | "unsupported"
  /** iPhone and iPad: push only works once Selkie is on the Home Screen. */
  | "install-first"
  /** The person said no; only the browser's own settings can undo that. */
  | "blocked"
  /** The server has no push keys. */
  | "unavailable"
  | "off"
  | "on";

const SW_URL = "/sw.js";
let serverKey: Promise<string | null> | null = null;

function keyFromServer(): Promise<string | null> {
  serverKey ??= api.push
    .key()
    .then((answer) => answer.publicKey)
    .catch(() => {
      serverKey = null;
      return null;
    });
  return serverKey;
}

function hasPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function isAppleMobile(): boolean {
  // iPadOS reports itself as a Mac; the touch points give it away.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function onHomeScreen(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function readState(): Promise<PushState> {
  if (!features.push) return "unsupported";
  if (!hasPush()) return isAppleMobile() && !onHomeScreen() ? "install-first" : "unsupported";
  if (!(await keyFromServer())) return "unavailable";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  return (await currentSubscription()) ? "on" : "off";
}

/** The VAPID key as the bytes PushManager wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((byte, i) => byte === key[i]);
}

async function enable(): Promise<PushState> {
  // Permission first, straight from the tap: Safari only shows the prompt
  // while the tap is still "fresh", and a network round trip can spend that.
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";
  const key = await keyFromServer();
  if (!key) return "unavailable";

  const registration = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  await navigator.serviceWorker.ready;
  const bytes = keyBytes(key);
  let subscription = await registration.pushManager.getSubscription();
  // Subscribed against an older server key: that subscription can never be
  // delivered to again.
  if (subscription && !sameKey(subscription, bytes)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  await api.push.subscribe(subscription.toJSON());
  return "on";
}

async function disable(): Promise<PushState> {
  const subscription = await currentSubscription();
  if (subscription) {
    await api.push.unsubscribe(subscription.endpoint).catch(() => {});
    await subscription.unsubscribe();
  }
  return "off";
}

/**
 * On sign-out: stop this browser being told about the money of someone who is
 * no longer signed in on it. Must run while the session still works.
 */
export async function stopPushHere(): Promise<void> {
  if (!features.push || typeof window === "undefined" || !hasPush()) return;
  await disable().catch(() => {});
}

/**
 * Re-tell the server about this browser on every visit. Cheap, and it repairs
 * the two ways a subscription goes missing on the server side: a browser that
 * changed hands between accounts, and a push service that rotated the endpoint.
 */
async function resync(): Promise<void> {
  const subscription = await currentSubscription();
  if (subscription) await api.push.subscribe(subscription.toJSON()).catch(() => {});
}

export function usePush() {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void readState().then((found) => {
      if (!live) return;
      setState(found);
      if (found === "on") void resync();
    });
    return () => {
      live = false;
    };
  }, []);

  const run = useCallback(async (step: () => Promise<PushState>) => {
    setBusy(true);
    setError(null);
    try {
      setState(await step());
    } catch (failure) {
      console.error(failure);
      setError("That did not work. Try again in a moment.");
      setState(await readState().catch(() => "off" as const));
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    state,
    busy,
    error,
    turnOn: useCallback(() => run(enable), [run]),
    turnOff: useCallback(() => run(disable), [run]),
  };
}
