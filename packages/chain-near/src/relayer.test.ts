import assert from "node:assert/strict";
import { test } from "node:test";
import { KeyPair } from "near-api-js";
import { signPrepared } from "./browser";
import { toBase64, fromBase64, type PreparedDelegate } from "./delegate";
import { directTransfer, holdTransfer, refundCall, TGAS } from "./escrow";
import { RelayRefusedError, assertRelayable, relayPolicy, verifySignedDelegate } from "./relayer";

const USDC = "usdc.test";
const ESCROW = "escrow.test";
const policy = relayPolicy({ usdc: USDC, escrow: ESCROW });

function prepared(key: KeyPair, call = directTransfer(USDC, { to: "bob.x.test", amount: "1000000" })): PreparedDelegate {
  return {
    senderId: "amaka.x.test",
    receiverId: call.receiverId,
    calls: call.calls,
    publicKey: key.getPublicKey().toString(),
    nonce: "42",
    maxBlockHeight: "1000",
  };
}

const signWith = (key: KeyPair) => async (hash: Uint8Array) => key.sign(hash).signature;

test("a delegate signed in the browser verifies against what was prepared", async () => {
  const key = KeyPair.fromRandom("ed25519");
  const p = prepared(key);
  const signed = await verifySignedDelegate(p, await signPrepared(p, signWith(key)));
  assert.equal(signed.delegateAction.senderId, "amaka.x.test");
  assert.equal(signed.delegateAction.receiverId, USDC);
});

test("changing anything after signing is refused", async () => {
  const key = KeyPair.fromRandom("ed25519");
  const p = prepared(key);
  const signedB64 = await signPrepared(p, signWith(key));

  // The user signed 1 USDC to bob; the relayer must not submit 1000 USDC to eve.
  const other = prepared(key, directTransfer(USDC, { to: "eve.x.test", amount: "1000000000" }));
  await assert.rejects(verifySignedDelegate(other, signedB64), RelayRefusedError);

  // Flip one byte of the signed payload itself.
  const bytes = fromBase64(signedB64);
  bytes[10] = (bytes[10] ?? 0) ^ 1;
  await assert.rejects(verifySignedDelegate(p, toBase64(bytes)), RelayRefusedError);
});

test("a signature from a different key is refused before the relayer pays", async () => {
  const owner = KeyPair.fromRandom("ed25519");
  const stranger = KeyPair.fromRandom("ed25519");
  const p = prepared(owner);
  await assert.rejects(verifySignedDelegate(p, await signPrepared(p, signWith(stranger))), /does not match/);
});

test("the relayer only pays for the product's own calls", () => {
  const key = KeyPair.fromRandom("ed25519");
  assert.doesNotThrow(() => assertRelayable(prepared(key), policy));
  assert.doesNotThrow(() =>
    assertRelayable(prepared(key, holdTransfer(USDC, ESCROW, { amount: "5", recipient: "ab".repeat(32), lifetimeSecs: 60 })), policy),
  );
  assert.doesNotThrow(() => assertRelayable(prepared(key, refundCall(ESCROW, "7")), policy));

  const elsewhere = prepared(key, { receiverId: "evil.test", calls: directTransfer(USDC, { to: "x", amount: "1" }).calls });
  assert.throws(() => assertRelayable(elsewhere, policy), /does not pay for calls/);

  const wrongMethod = prepared(key, { receiverId: ESCROW, calls: [{ ...refundCall(ESCROW, "1").calls[0]!, methodName: "claim" }] });
  assert.throws(() => assertRelayable(wrongMethod, policy), /does not pay for escrow.test.claim/);

  const rich = prepared(key, { receiverId: USDC, calls: [{ ...directTransfer(USDC, { to: "x", amount: "1" }).calls[0]!, deposit: "2" }] });
  assert.throws(() => assertRelayable(rich, policy), /deposit/);

  const greedy = prepared(key, { receiverId: USDC, calls: [{ ...directTransfer(USDC, { to: "x", amount: "1" }).calls[0]!, gas: (301n * TGAS).toString() }] });
  assert.throws(() => assertRelayable(greedy, policy), /Gas/);
});
