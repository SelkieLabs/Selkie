import { resolve } from "node:path";
import { assertUsableBotSecret } from "@selkie/core";
import type { XCredentials } from "./x/client";

/**
 * What the bot needs to run, read once at startup.
 *
 * A surface starts only when its credentials are present, so one process can run
 * X alone today and X and Telegram tomorrow without a flag to remember. A
 * missing X key is not an error: it means this deployment does not do X.
 */

export interface BotConfig {
  /** Selkie's own API. */
  apiUrl: string;
  /** Where people are pointed to open their wallet. */
  webUrl: string;
  /** Proves to the API which person the bot is acting for. */
  botSecret: string;
  /** Where the last-handled mention id is kept. */
  statePath: string;
  /**
   * Work out every reply and post none of them.
   *
   * On unless explicitly turned off, because the failure modes point opposite
   * ways: a quiet bot is a bug someone notices, and a bot loose on a public
   * timeline with a payment API behind it is not something you can take back.
   */
  dryRun: boolean;
  x?: XCredentials & { handle: string; pollMs: number; activeMs: number };
}

export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const botSecret = required(env, "SELKIE_BOT_SECRET");
  // Fail here rather than on the first payment somebody tries to make.
  assertUsableBotSecret(botSecret);

  return {
    apiUrl: env.SELKIE_API_URL ?? "http://127.0.0.1:4000",
    webUrl: env.SELKIE_WEB_URL ?? "https://selkiepay.vercel.app",
    botSecret,
    statePath: env.SELKIE_BOT_STATE ?? resolve(process.cwd(), ".data/x-state.json"),
    dryRun: !isOff(env.SELKIE_BOT_DRY_RUN),
    x: xCredentials(env),
  };
}

function xCredentials(env: NodeJS.ProcessEnv): BotConfig["x"] {
  const apiKey = env.X_API_KEY;
  const apiSecret = env.X_API_SECRET;
  const accessToken = env.X_ACCESS_TOKEN;
  const accessSecret = env.X_ACCESS_SECRET;

  // All four or none. Three of four is a half-finished setup that would fail
  // later with an unhelpful 401 rather than now with a clear message.
  const present = [apiKey, apiSecret, accessToken, accessSecret].filter(Boolean).length;
  if (present === 0) return undefined;
  if (present < 4 || !apiKey || !apiSecret || !accessToken || !accessSecret) {
    throw new Error(
      "X is half configured. Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN and X_ACCESS_SECRET, or none of them.",
    );
  }

  const slowest = seconds(env.X_POLL_SECONDS, { fallback: 15, floor: 5 });
  const fastest = seconds(env.X_ACTIVE_POLL_SECONDS, { fallback: 3, floor: 2 });

  return {
    apiKey,
    apiSecret,
    accessToken,
    accessSecret,
    handle: (env.X_HANDLE ?? "SelkiePay").replace(/^@/, ""),
    pollMs: slowest * 1000,
    // The floor cannot be above the ceiling. Configured the other way round
    // the clamp between them would have no room to work in.
    activeMs: Math.min(fastest, slowest) * 1000,
  };
}

/**
 * A number of seconds from the environment, with a floor.
 *
 * These two are only the bounds. How fast the bot actually polls is worked out
 * at runtime from the quota X reports on every response, because that is the
 * only number that knows what this account can afford, and it is right across a
 * change of plan without anybody remembering to edit anything. The slower of
 * the two is what it falls back to when X sends no quota at all.
 *
 * The floor here is a guard rather than a policy: it stops a stray value
 * turning the wait between polls into a tight loop against a metered API.
 *
 * Anything unreadable falls back rather than becoming NaN, which would sail
 * through a `Math.max` floor untouched and produce exactly that loop.
 */
function seconds(value: string | undefined, { fallback, floor }: { fallback: number; floor: number }): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(floor, parsed);
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. The bot will not start without it, because a bot that cannot prove who it is acting for should not be acting.`,
    );
  }
  return value;
}

/** Explicitly off. Anything else, including nothing at all, is on. */
function isOff(value: string | undefined): boolean {
  return value === "0" || value?.toLowerCase() === "false";
}
