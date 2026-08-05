import type { HandleRef } from "../chains/types";

/**
 * How a bot proves who it is acting for.
 *
 * The web app sends the user's own login token and the API asks the provider
 * whether it is genuine. A bot cannot do that: it holds no login for the person
 * who tweeted at it. What it holds instead is X's word. When the X API returns a
 * mention, X has already attested that this numeric author id wrote this text.
 * That attestation is exactly what an identity provider returns, so the bot
 * re-states it in a token the API can check, and the API treats it as one more
 * provider rather than as a special back door.
 *
 * The consequence is worth being blunt about: this secret can act as any user
 * who has linked the platform it names. It is a key to other people's money.
 * Hence the deliberate narrowness below.
 *
 *  - Payable platforms only. A bot can never mint a Google identity, because
 *    Google is a door you log in through, not an address money goes to, and
 *    letting a leaked bot secret impersonate a login is a different and worse
 *    class of compromise.
 *  - Seconds, not hours. A token copied out of a log is useless almost at once.
 *  - A nonce per token, so two identical commands are still two distinct tokens
 *    and a replay is visible as one.
 *  - Verified through the platform's own HMAC check, which does not leak the
 *    signature a byte at a time by how long a rejection takes.
 *
 * Web Crypto rather than node:crypto, because core stays runtime-neutral: the
 * same handle hashing runs in a browser, and this should too.
 */

/** Platforms a bot may speak for. Payable handles only, never a login-only door. */
export const BOT_PLATFORMS = ["x", "telegram"] as const;
export type BotPlatform = (typeof BOT_PLATFORMS)[number];

/** Version prefix, so the format can change without a confusing failure. */
const VERSION = "sb1";

/** Long enough that guessing is hopeless. Enforced, not suggested. */
export const MIN_BOT_SECRET_LENGTH = 32;

/** Default lifetime. Long enough for a slow network, short enough to be useless later. */
const DEFAULT_TTL_MS = 60_000;

/**
 * Clock slack between the bot and the API.
 *
 * Two machines are never perfectly in step, and a payment refused because a
 * server was a second fast is a bug the user experiences as "Selkie is broken".
 */
const CLOCK_SKEW_MS = 30_000;

export interface BotIdentityClaim {
  platform: BotPlatform;
  /**
   * The platform's permanent id, e.g. the numeric X user id. Never the handle:
   * handles get renamed and re-registered, and keying on the string would
   * eventually hand one person's money to a stranger.
   */
  subject: string;
  /** The handle as it reads today, for display and payment routing. */
  username?: string;
}

interface Payload extends BotIdentityClaim {
  /** Unique per token, so a replay is a repeat rather than a coincidence. */
  nonce: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

export class BotTokenError extends Error {}

/** Refuse a secret too weak to be worth having. */
export function assertUsableBotSecret(secret: string): void {
  if (secret.length < MIN_BOT_SECRET_LENGTH) {
    throw new BotTokenError(
      `A bot secret must be at least ${MIN_BOT_SECRET_LENGTH} characters. It can spend other people's money, so a short one is not a small problem.`,
    );
  }
}

/**
 * Mint a token asserting that this person authored the message being acted on.
 *
 * Only ever called with an id the platform itself just returned. Calling it with
 * a handle typed by a user would turn the whole design into an impersonation
 * endpoint.
 */
export async function signBotToken(
  claim: BotIdentityClaim,
  secret: string,
  options: { ttlMs?: number; now?: number } = {},
): Promise<string> {
  assertUsableBotSecret(secret);
  if (!isBotPlatform(claim.platform)) {
    throw new BotTokenError(`A bot cannot act for ${claim.platform}.`);
  }
  if (!claim.subject) throw new BotTokenError("A bot token needs a subject.");

  const now = options.now ?? Date.now();
  const payload: Payload = {
    platform: claim.platform,
    subject: claim.subject,
    username: claim.username?.toLowerCase(),
    nonce: toBase64Url(crypto.getRandomValues(new Uint8Array(9))),
    expiresAt: now + (options.ttlMs ?? DEFAULT_TTL_MS),
  };

  const body = `${VERSION}.${toBase64Url(utf8(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Check a token and return what it claims, or throw.
 *
 * Order matters: the signature is verified before the payload is trusted for
 * anything at all, including its own expiry. Reading a field out of an unsigned
 * payload to decide whether to check the signature is how these get broken.
 */
export async function verifyBotToken(
  token: string,
  secret: string,
  options: { now?: number } = {},
): Promise<BotIdentityClaim> {
  assertUsableBotSecret(secret);

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new BotTokenError("Not a bot token.");
  }
  const [, encoded, signature] = parts as [string, string, string];

  const given = tryDecode(signature);
  const body = utf8(`${VERSION}.${encoded}`);
  if (!given || !(await crypto.subtle.verify("HMAC", await hmacKey(secret), given, body))) {
    throw new BotTokenError("That bot token is not signed by us.");
  }

  const raw = tryDecode(encoded);
  let payload: Payload;
  try {
    if (!raw) throw new Error("undecodable");
    payload = JSON.parse(new TextDecoder().decode(raw)) as Payload;
  } catch {
    throw new BotTokenError("That bot token is malformed.");
  }

  if (!isBotPlatform(payload.platform)) {
    // Signed by us, but naming a platform a bot may not speak for. Either the
    // rules tightened since it was minted or something is very wrong.
    throw new BotTokenError(`A bot cannot act for ${payload.platform}.`);
  }
  if (!payload.subject || typeof payload.subject !== "string") {
    throw new BotTokenError("That bot token names nobody.");
  }

  const now = options.now ?? Date.now();
  if (typeof payload.expiresAt !== "number" || payload.expiresAt + CLOCK_SKEW_MS < now) {
    throw new BotTokenError("That bot token has expired.");
  }

  return {
    platform: payload.platform,
    subject: payload.subject,
    username: payload.username,
  };
}

/** The handle a bot claim points at, when it names one. */
export function claimHandle(claim: BotIdentityClaim): HandleRef | null {
  if (!claim.username) return null;
  return { platform: claim.platform, username: claim.username.toLowerCase() };
}

export function isBotPlatform(value: string): value is BotPlatform {
  return (BOT_PLATFORMS as readonly string[]).includes(value);
}

// Pinned to ArrayBuffer rather than ArrayBufferLike: Web Crypto will not accept
// a view that might be backed by a SharedArrayBuffer, and TextEncoder's type is
// the looser of the two.
function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode, or null for anything that is not valid base64url. Never throws. */
function tryDecode(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}
