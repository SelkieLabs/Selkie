/**
 * Which chain this build of the web app runs on, and what that lets it show.
 *
 * NEAR is the default on this branch: it is the product people see. Stellar is
 * still here (NEXT_PUBLIC_SELKIE_CHAIN=stellar) and nothing it needs has been
 * deleted; features it alone supports are hidden by these flags, not removed.
 */
export type Chain = "near" | "stellar";

export const CHAIN: Chain = process.env.NEXT_PUBLIC_SELKIE_CHAIN === "stellar" ? "stellar" : "near";
export const isNear = CHAIN === "near";

export const NEAR_NETWORK = process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

/** What the current chain supports. Read these instead of checking the chain by name. */
export const features = {
  /** Swap between assets on the Stellar DEX. */
  convert: !isNear,
  /** Asking someone for money. */
  requests: !isNear,
  /** Telegram as a payable handle. NEAR accounts are named after X handles only. */
  telegram: !isNear,
  /** Google as a sign-in door. On NEAR the account is created from the X login. */
  google: !isNear,
  /** Airtime, bills and the naira off-ramp. */
  localPayouts: !isNear,
  /** Pay a list of handles at once. */
  payMany: !isNear,
  /** Cash out to a bank or another chain. */
  cashOut: !isNear,
} as const;
