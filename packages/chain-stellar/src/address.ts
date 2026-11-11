import { StrKey } from "@stellar/stellar-sdk";

/**
 * Is this a Stellar address someone can be paid at?
 *
 * Checked properly rather than by shape. A public key is 56 characters starting
 * with G, but so is a string of 56 characters starting with G, and the
 * difference is a checksum. Money sent to a mistyped address is gone, so the
 * one place that decides "this is an address, not a handle" decides it with the
 * same rule the network uses.
 */
export function isStellarAddress(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value.trim().toUpperCase());
}

/**
 * Is this shaped like an address, whether or not it is a valid one?
 *
 * The difference between this and `isStellarAddress` is the difference between
 * "you meant an address" and "this address works". Something 56 characters long
 * starting with G is nobody's handle; if it fails the checksum it is a typo, and
 * the only safe answer is to refuse it. Treating it as a handle instead would
 * quietly send money to a stranger who registered that name.
 */
export function looksLikeAddress(value: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(value.trim().toUpperCase());
}

/** An address, shortened for display. Never for anything that moves money. */
export function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}
