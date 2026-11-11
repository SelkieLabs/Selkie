/**
 * Relayer safety (design 5.5): what the relayer will and will not pay for.
 *
 * The relayer key pays gas for anything it submits, so the danger is not that it
 * can steal (it cannot change what a user signed) but that it can be made to pay
 * for things Selkie never offered. Two checks close that:
 *
 *  1. Policy: a prepared action may only call the USDC or escrow contract, only
 *     the methods the product uses, with at most 1 yoctoNEAR and capped gas.
 *  2. Exactness: the signed bytes must be byte-for-byte the bytes Selkie
 *     prepared, signed by the key the prepare named. Nothing is interpreted, so
 *     there is nothing to trick.
 */
import { PublicKey, type SignedDelegate } from "near-api-js";
import { delegateHash, encodeSigned, fromBase64, signedDelegate, type PreparedDelegate } from "./delegate";
import { ONE_YOCTO } from "./amounts";
import { MAX_RELAYED_GAS, MAX_RELAYED_TOTAL_GAS } from "./escrow";

export class RelayRefusedError extends Error {}

export interface RelayPolicy {
  /** receiverId -> methods allowed on it. */
  allowed: Record<string, readonly string[]>;
}

export function relayPolicy(input: { usdc: string; escrow: string; extra?: Record<string, readonly string[]> }): RelayPolicy {
  return {
    allowed: {
      [input.usdc]: ["ft_transfer", "ft_transfer_call", "storage_deposit"],
      [input.escrow]: ["refund"],
      ...input.extra,
    },
  };
}

/** Throws RelayRefusedError unless every call is one the relayer is willing to fund. */
export function assertRelayable(prepared: PreparedDelegate, policy: RelayPolicy): void {
  const methods = policy.allowed[prepared.receiverId];
  if (!methods) throw new RelayRefusedError(`Relayer does not pay for calls to ${prepared.receiverId}`);
  if (prepared.calls.length === 0) throw new RelayRefusedError("Nothing to relay");
  const total = prepared.calls.reduce((sum, call) => sum + BigInt(call.gas), 0n);
  if (total > MAX_RELAYED_TOTAL_GAS) throw new RelayRefusedError("Total gas above the relayer's cap");
  for (const call of prepared.calls) {
    if (!methods.includes(call.methodName)) {
      throw new RelayRefusedError(`Relayer does not pay for ${prepared.receiverId}.${call.methodName}`);
    }
    if (BigInt(call.deposit) > ONE_YOCTO) throw new RelayRefusedError("Attached deposit above 1 yoctoNEAR");
    if (BigInt(call.gas) > MAX_RELAYED_GAS) throw new RelayRefusedError("Gas above the relayer's cap");
  }
}

/**
 * Check a base64 SignedDelegate against what was prepared and return it ready
 * to submit. Throws RelayRefusedError on any difference or a bad signature.
 */
export async function verifySignedDelegate(prepared: PreparedDelegate, signedBase64: string): Promise<SignedDelegate> {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(signedBase64);
  } catch {
    throw new RelayRefusedError("Signed delegate is not base64");
  }
  // A borsh SignedDelegate ends with the signature: a 1-byte key type (0 =
  // ed25519) then 64 bytes. Everything before it must be what we prepared.
  if (bytes.length < 65 || bytes[bytes.length - 65] !== 0) {
    throw new RelayRefusedError("Signed delegate is not ed25519-signed");
  }
  const signature = bytes.slice(bytes.length - 64);
  const expected = encodeSigned(prepared, signature);
  if (!equalBytes(bytes, expected)) throw new RelayRefusedError("Signed delegate differs from what was prepared");

  // The chain would reject a bad signature too, but only after the relayer had
  // paid to find out.
  const hash = await delegateHash(prepared);
  if (!PublicKey.fromString(prepared.publicKey).verify(hash, signature)) {
    throw new RelayRefusedError("Signature does not match the account's key");
  }
  return signedDelegate(prepared, signature);
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
