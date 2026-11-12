/**
 * The X pocket, in the browser: the few numbers the Settings section checks
 * before it asks anyone to sign.
 *
 * The contract compares base units, so these do too. Typing "0.1 + 0.2" worth
 * of floats into a limit check is how a form lets through a top-up the chain
 * then refuses, after the person has already signed it.
 */

/** USDC on NEAR has 6 decimals. */
const DECIMALS = 6;

/**
 * The limit a pocket starts with when the first top-up names none. Mirrors the
 * contract's DEFAULT (10_000_000 base units); the contract is the one that
 * applies it, this only says it out loud.
 */
export const DEFAULT_DAILY_LIMIT = "10";

/** "12.5" -> 12_500_000n. Null for anything that is not a plain decimal. */
export function usdcUnits(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > DECIMALS) return null;
  return BigInt(match[1]) * 10n ** BigInt(DECIMALS) + BigInt(fraction.padEnd(DECIMALS, "0") || "0");
}

/** More than zero, as typed. */
export function isPositive(value: string): boolean {
  const units = usdcUnits(value);
  return units !== null && units > 0n;
}

/** `a > b`, for two decimal USDC strings. Unreadable values never count as more. */
export function isMore(a: string, b: string): boolean {
  const left = usdcUnits(a);
  const right = usdcUnits(b);
  return left !== null && right !== null && left > right;
}

/** How full today's allowance still is, 0 to 100, for the gauge. */
export function leftShare(left: string, cap: string): number {
  const l = usdcUnits(left);
  const c = usdcUnits(cap);
  if (l === null || c === null || c === 0n) return 0;
  if (l >= c) return 100;
  return Number((l * 1000n) / c) / 10;
}
