/**
 * The browser half of prepare -> sign -> relay (`@selkie/chain-near/browser`).
 *
 * Deliberately knows nothing about Privy: the frontend passes in a function that
 * signs a 32-byte hash with the user's key. That keeps the wallet provider a
 * detail of the web app and keeps this file testable with a plain keypair.
 */
import { KeyType, PublicKey } from "near-api-js";
import { delegateHash, encodeSigned, fromHex, toBase64, type PreparedDelegate } from "./delegate";

export type { PreparedCall, PreparedDelegate } from "./delegate";
export { fromHex, toHex } from "./delegate";
export { isValidAccountId } from "./names";
export { MAX_PAY_MANY } from "./escrow";

/** Signs a 32-byte hash with the user's ed25519 key; returns the 64-byte signature. */
export type SignHash = (hash: Uint8Array) => Promise<Uint8Array>;

/**
 * Sign what the backend prepared and return the base64 SignedDelegate the relay
 * endpoint expects. The user's key signs; Selkie's relayer only pays the gas.
 */
export async function signPrepared(prepared: PreparedDelegate, signHash: SignHash): Promise<string> {
  const hash = await delegateHash(prepared);
  const signature = await signHash(hash);
  return toBase64(encodeSigned(prepared, signature));
}

/** The implicit account id of an ed25519 key is its hex; Privy reports NEAR wallets that way. */
export function publicKeyFromImplicit(address: string): string {
  if (!/^[0-9a-f]{64}$/.test(address)) throw new Error("Not a NEAR implicit address");
  return new PublicKey({ keyType: KeyType.ED25519, data: fromHex(address) }).toString();
}
