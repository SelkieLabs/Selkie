import { NEAR_NETWORK, isNear } from "./chain";

/**
 * Where to look a payment up on the public record.
 *
 * The network is read once, here, rather than written into each link. Every
 * explorer URL in the app used to say `testnet` in the markup, which is fine
 * until the day it is not and someone follows a link to a page insisting their
 * money does not exist.
 */
const STELLAR_NETWORK = process.env.NEXT_PUBLIC_SELKIE_NETWORK === "public" ? "public" : "testnet";

// Testnet verified live (11 Nov). Mainnet is set explicitly, never guessed.
const NEAR_EXPLORER = (
  process.env.NEXT_PUBLIC_NEAR_EXPLORER ??
  (NEAR_NETWORK === "testnet" ? "https://explorer.testnet.near.org" : "")
).replace(/\/$/, "");

export const explorer = isNear
  ? {
      network: NEAR_NETWORK,
      transaction: (ref: string) => `${NEAR_EXPLORER}/transactions/${ref}`,
      account: (address: string) => `${NEAR_EXPLORER}/accounts/${address}`,
    }
  : {
      network: STELLAR_NETWORK,
      /** A single payment. Only ever called with a real transaction reference. */
      transaction: (ref: string) => `https://stellar.expert/explorer/${STELLAR_NETWORK}/tx/${ref}`,
      account: (address: string) => `https://stellar.expert/explorer/${STELLAR_NETWORK}/account/${address}`,
    };
