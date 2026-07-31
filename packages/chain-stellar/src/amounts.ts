/**
 * Money math. Every amount crossing this boundary is a decimal string on the
 * product side and a bigint of stroops on the chain side. Floats never touch a
 * balance: `0.1 + 0.2` is not `0.3`, and in a payments app that is a bug you
 * cannot apologise your way out of.
 */

/** Stellar classic assets and their contract counterparts all use 7 decimals. */
export const STELLAR_DECIMALS = 7;

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export class AmountError extends Error {}

/**
 * "10.50" -> 105000000n. Rejects anything that is not a plain decimal number,
 * and refuses to silently drop precision.
 */
export function toStroops(amount: string, decimals: number = STELLAR_DECIMALS): bigint {
  const trimmed = amount.trim();
  if (!DECIMAL_RE.test(trimmed)) {
    throw new AmountError(`Not a decimal amount: ${JSON.stringify(amount)}`);
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  if (fraction.length > decimals) {
    throw new AmountError(
      `${amount} has more than ${decimals} decimal places, which this asset cannot represent`,
    );
  }
  const padded = fraction.padEnd(decimals, "0");
  const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
  return negative ? -value : value;
}

/** 105000000n -> "10.5". Trailing zeros are trimmed, "0" stays "0". */
export function fromStroops(stroops: bigint, decimals: number = STELLAR_DECIMALS): string {
  const negative = stroops < 0n;
  const value = negative ? -stroops : stroops;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const text = fraction ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${text}` : text;
}

/** The decimal string form the Stellar SDK wants for classic operations. */
export function toStellarAmount(amount: string, decimals: number = STELLAR_DECIMALS): string {
  return fromStroops(toStroops(amount, decimals), decimals);
}

/** Apply a slippage tolerance (in basis points) to a minimum-received amount. */
export function applySlippage(stroops: bigint, basisPoints: number): bigint {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints >= 10_000) {
    throw new AmountError(`Slippage must be an integer between 0 and 9999 bps, got ${basisPoints}`);
  }
  return (stroops * BigInt(10_000 - basisPoints)) / 10_000n;
}

export function assertPositive(amount: string, decimals: number = STELLAR_DECIMALS): bigint {
  const stroops = toStroops(amount, decimals);
  if (stroops <= 0n) throw new AmountError(`Amount must be greater than zero, got ${amount}`);
  return stroops;
}
