import { isValidAccountId } from "@selkie/chain-near/browser";
import { NEAR_NETWORK, isNear } from "@/lib/chain";
import { looksLikeAddress, shortAddress } from "@/lib/format";

const NEAR_EXAMPLE = NEAR_NETWORK === "mainnet" ? "alice.near" : "alice.testnet";

/**
 * What "an address" means on this chain, for every screen that takes one.
 *
 * On Stellar it is a G... key. On NEAR it is an account name (alice.testnet,
 * an exchange's deposit account) or a 64-character implicit account. Send and
 * Cash out read the same rules, so a name one accepts the other never refuses.
 */
export const ADDRESS = isNear
  ? {
      tab: "A NEAR account",
      label: "NEAR account",
      confirmLabel: "Sending to this NEAR account",
      placeholder: NEAR_EXAMPLE,
      capitalize: "none",
      clean: (raw: string) => raw.trim().toLowerCase(),
      valid: isValidAccountId,
      invalid: `That is not a NEAR account name. It looks like ${NEAR_EXAMPLE}, or 64 letters and numbers.`,
      blurb:
        "Straight to any NEAR account: yours, a friend's, or an exchange. Nothing waits and nothing can be taken back, so check it twice.",
      /** Names are short and meaningful; only the 64-hex implicit form is worth shortening. */
      short: (value: string) => (/^[0-9a-f]{64}$/.test(value) ? shortAddress(value) : value),
    }
  : {
      tab: "An address",
      label: "Wallet address",
      confirmLabel: "Sending to this wallet",
      placeholder: "G…",
      capitalize: "characters",
      clean: (raw: string) => raw.trim().toUpperCase(),
      valid: looksLikeAddress,
      invalid: "That is not a complete address. It starts with G and is 56 characters long.",
      blurb: "Straight to a wallet address. Nothing waits and nothing can be taken back, so check it twice.",
      short: shortAddress,
    };
