/**
 * The two places a handle can live.
 *
 * A platform is not decoration: it is half of the address. `@amaka` on X and
 * `@amaka` on Telegram are different people, and the escrow contract hashes
 * `"<platform>:<username>"`, so sending to the wrong one sends to a stranger.
 * Every screen that takes a handle takes a platform with it, and they all read
 * the labels from here so the wording never drifts.
 */
import { features } from "./chain";

export type Platform = "x" | "telegram";

/** The platforms this build can pay. NEAR accounts are named after X handles only. */
export const PLATFORMS: Platform[] = features.telegram ? ["x", "telegram"] : ["x"];

export const PLATFORM_LABEL: Record<Platform, string> = {
  x: "X",
  telegram: "Telegram",
};

/** What the field asks for, in the platform's own words. */
export const PLATFORM_FIELD: Record<Platform, string> = {
  x: "Their X handle",
  telegram: "Their Telegram username",
};

export const PLATFORM_PLACEHOLDER: Record<Platform, string> = {
  x: "amaka",
  telegram: "amaka",
};

export const isPlatform = (value: string): value is Platform =>
  (PLATFORMS as string[]).includes(value);
