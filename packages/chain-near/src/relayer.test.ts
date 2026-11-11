import assert from "node:assert/strict";
import { test } from "node:test";
import { KeyPair } from "near-api-js";
import { signPrepared } from "./browser";
import { toBase64, fromBase64, type PreparedDelegate } from "./delegate";
import { MAX_PAY_MANY, directTransfer, holdTransfer, payManyCall, refundCall, TGAS } from "./escrow";
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

test("pay many: direct transfers and one hold_many share a delegate, under the gas cap", async () => {
  const key = KeyPair.fromRandom("ed25519");
  const holds = [{ recipient: "ab".repeat(32), amount: "1000000" }];
  const direct = Array.from({ length: MAX_PAY_MANY - 1 }, (_, i) => ({ to: `p${i}.x.test`, amount: "1000000" }));
  const call = payManyCall(USDC, ESCROW, { direct, holds, lifetimeSecs: 60, memo: "team" });

  assert.equal(call.receiverId, USDC);
  assert.deepEqual(
    call.calls.map((c) => c.methodName),
    [...direct.map(() => "ft_transfer"), "ft_transfer_call"],
  );
  const msg = JSON.parse(JSON.parse(call.calls.at(-1)!.argsJson).msg);
  assert.deepEqual(msg, { kind: "hold_many", lifetime_secs: 60, items: holds });

  // The biggest batch the product builds is still one the relayer will pay for, and signs.
  const biggest = prepared(key, call);
  assert.doesNotThrow(() => assertRelayable(biggest, policy));
  await verifySignedDelegate(biggest, await signPrepared(biggest, signWith(key)));

  // One more direct transfer than that tips it over the total cap.
  const tooBig = prepared(key, payManyCall(USDC, ESCROW, { direct: [...direct, ...direct], holds, lifetimeSecs: 60 }));
  assert.throws(() => assertRelayable(tooBig, policy), /Total gas/);
});
