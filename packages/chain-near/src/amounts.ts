/**
 * Money math for NEAR. Amounts are decimal strings on the product side and
 * bigints of base units on the chain side; floats never touch a balance.
 * USDC on NEAR has 6 decimals (read from the token's ft_metadata, not assumed:
 * see config.ts), so "1.50" is 1500000n.
 */

export const USDC_DECIMALS = 6;
/** 1 yoctoNEAR: what NEP-141 transfers must attach to prove a full-access signer. */
export const ONE_YOCTO = 1n;

const DECIMAL_RE = /^\d+(\.\d+)?$/;

export class AmountError extends Error {}

/** "1.50" -> 1500000n. Refuses negatives, junk, and precision it would have to drop. */
export function toBaseUnits(amount: string, decimals: number = USDC_DECIMALS): bigint {
  const trimmed = amount.trim();
  if (!DECIMAL_RE.test(trimmed)) throw new AmountError(`Not a decimal amount: ${JSON.stringify(amount)}`);
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new AmountError(`${amount} has more than ${decimals} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** 1500000n -> "1.5". Trailing zeros trimmed; "0" stays "0". */
export function fromBaseUnits(units: bigint | string, decimals: number = USDC_DECIMALS): string {
  const value = BigInt(units);
  if (value < 0n) throw new AmountError(`Negative amount: ${value}`);
  const scale = 10n ** BigInt(decimals);
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${value / scale}.${fraction}` : `${value / scale}`;
}

/** A positive amount in base units, for anything that moves money. */
export function toPositiveBaseUnits(amount: string, decimals: number = USDC_DECIMALS): bigint {
  const units = toBaseUnits(amount, decimals);
  if (units <= 0n) throw new AmountError("Amount must be more than zero");
  return units;
}
