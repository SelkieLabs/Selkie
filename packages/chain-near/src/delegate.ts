/**
 * NEP-366 delegate actions, shared by the browser (which signs) and the
 * relayer (which checks and submits).
 *
 * The backend decides exactly what a user is asked to sign and hands it over as
 * a `PreparedDelegate`: plain JSON, so it survives HTTP and a database row.
 * Both sides rebuild the same DelegateAction from it with the same code, which
 * is what lets the relayer insist that the bytes it is given are byte-for-byte
 * the bytes it prepared, rather than trying to read intent out of them.
 */
import {
  KeyType,
  PublicKey,
  Signature,
  actions,
  buildDelegateAction,
  encodeDelegateAction,
  encodeSignedDelegate,
  type DelegateAction,
  type SignedDelegate,
} from "near-api-js";

/** One function call the user is asked to sign. */
export interface PreparedCall {
  methodName: string;
  /**
   * The exact JSON text of the arguments. Kept as text, not an object, because
   * the signature covers bytes: re-serialising an object (or storing it as
   * jsonb, which reorders keys) could produce different bytes for the same
   * meaning and a relayer that rejects honest signatures.
   */
  argsJson: string;
  /** Gas units, decimal string. */
  gas: string;
  /** Attached yoctoNEAR, decimal string. */
  deposit: string;
}

export interface PreparedDelegate {
  senderId: string;
  receiverId: string;
  calls: PreparedCall[];
  /** The access key that will sign, `ed25519:...`. */
  publicKey: string;
  /** The key's current nonce plus one, decimal string. */
  nonce: string;
  /** Past this block the signature is worthless, which bounds a replay window. */
  maxBlockHeight: string;
}

export function preparedCall(methodName: string, args: unknown, gas: bigint, deposit: bigint): PreparedCall {
  return { methodName, argsJson: JSON.stringify(args), gas: gas.toString(), deposit: deposit.toString() };
}

export function toDelegateAction(prepared: PreparedDelegate): DelegateAction {
  return buildDelegateAction({
    senderId: prepared.senderId,
    receiverId: prepared.receiverId,
    actions: prepared.calls.map((call) =>
      actions.functionCall(
        call.methodName,
        new TextEncoder().encode(call.argsJson),
        BigInt(call.gas),
        BigInt(call.deposit),
      ),
    ),
    nonce: BigInt(prepared.nonce),
    maxBlockHeight: BigInt(prepared.maxBlockHeight),
    publicKey: PublicKey.fromString(prepared.publicKey),
  });
}

/**
 * What gets signed: sha256 of the NEP-461-prefixed borsh encoding. The library
 * adds the prefix; hand-rolling it is how signatures end up valid for a
 * transaction as well as a delegate action.
 */
export async function delegateHash(prepared: PreparedDelegate): Promise<Uint8Array> {
  const encoded = encodeDelegateAction(toDelegateAction(prepared));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
}

/** Attach a 64-byte ed25519 signature to the prepared action. */
export function signedDelegate(prepared: PreparedDelegate, signature: Uint8Array): SignedDelegate {
  if (signature.length !== 64) throw new Error("An ed25519 signature is 64 bytes");
  // near-api-js 7.4 types SignedDelegate as a class but does not export it at
  // runtime; the action constructor builds one, so take it from there.
  const action = actions.signedDelegate({
    delegateAction: toDelegateAction(prepared),
    signature: new Signature({ keyType: KeyType.ED25519, data: signature }),
  });
  return action.signedDelegate!;
}

export function encodeSigned(prepared: PreparedDelegate, signature: Uint8Array): Uint8Array {
  return encodeSignedDelegate(signedDelegate(prepared, signature));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  if (!/^([0-9a-f]{2})*$/i.test(clean)) throw new Error("Not hex");
  return Uint8Array.from(clean.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
