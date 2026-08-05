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
  x?: XCredentials & { handle: string; pollMs: number };
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

  return {
    apiKey,
    apiSecret,
    accessToken,
    accessSecret,
    handle: (env.X_HANDLE ?? "SelkiePay").replace(/^@/, ""),
    pollMs: pollSeconds(env.X_POLL_SECONDS) * 1000,
  };
}

/**
 * How often to look, in seconds.
 *
 * Floored at 15 rather than allowing anything smaller. X counts reads against a
 * quota per fifteen minutes, and polling twice as often does not make a reply
 * arrive twice as fast: it spends the quota in half the time and then everything
 * waits for the window to reopen. Quicker than the quota allows is slower.
 *
 * Anything unreadable falls back to the default rather than becoming NaN, which
 * would sail through a `Math.max` floor and turn the wait between polls into no
 * wait at all.
 */
function pollSeconds(value: string | undefined, fallback = 30): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return Math.max(15, seconds);
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
