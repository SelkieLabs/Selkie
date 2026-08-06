/**
 * Where to look a payment up on the public record.
 *
 * The network is read once, here, rather than written into each link. Every
 * explorer URL in the app used to say `testnet` in the markup, which is fine
 * until the day it is not and someone follows a link to a page insisting their
 * money does not exist.
 */
const NETWORK = process.env.NEXT_PUBLIC_SELKIE_NETWORK === "public" ? "public" : "testnet";

export const explorer = {
  network: NETWORK,
  /** A single payment. Only ever called with a real transaction reference. */
  transaction: (ref: string) => `https://stellar.expert/explorer/${NETWORK}/tx/${ref}`,
  account: (address: string) => `https://stellar.expert/explorer/${NETWORK}/account/${address}`,
};
