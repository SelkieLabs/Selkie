/**
 * The whole NEAR money path, live on testnet, without a browser.
 *
 *   npm run test:live:near
 *
 * 1. hold:    the sender signs a delegate action that holds 0.01 USDC in the
 *             escrow for a handle nobody has claimed; the relayer submits it.
 * 2. account: a handle account is created with a brand-new key as its only key.
 * 3. proof:   that account's key list holds no key of Selkie's.
 * 4. claim:   the oracle releases the held money into the new account.
 * 5. refund:  a second hold with a one-second wait is taken back by its sender.
 *
 * Signing goes through the same code the web app uses (prepare -> signPrepared
 * -> verifySignedDelegate -> relay); only the signer differs. Here it is the
 * root account's local key, standing in for a user's Privy wallet.
 *
 * Spends 0.02 USDC (0.01 claimed into a throwaway account, 0.01 refunded) and a
 * little testnet NEAR. Needs USDC in NEAR_ROOT_ACCOUNT: faucet.circle.com, NEAR
 * Testnet. Testnet only.
 */
import assert from "node:assert/strict";
import { KeyPair, type KeyPairString } from "near-api-js";
import { signPrepared } from "../src/browser";
import { NearChain, type TxOutcome } from "../src/chain";
import { nearConfigFromEnv } from "../src/config";
import { holdTransfer, refundCall, type Call } from "../src/escrow";
import { recipientKeyFor } from "../src/recipient";
import { assertRelayable, relayPolicy, verifySignedDelegate } from "../src/relayer";

const AMOUNT = 10_000n; // 0.01 USDC
const config = nearConfigFromEnv();
if (config.network !== "testnet") throw new Error("test:live:near only runs on testnet.");
const senderId = process.env.NEAR_ROOT_ACCOUNT;
const senderSecret = process.env.NEAR_ROOT_KEY as KeyPairString | undefined;
if (!senderId || !senderSecret) throw new Error("NEAR_ROOT_ACCOUNT and NEAR_ROOT_KEY are needed (npm run near:setup).");

const chain = new NearChain(config);
const sender = KeyPair.fromString(senderSecret);
const policy = relayPolicy({ usdc: config.usdcContract, escrow: config.escrowContract });
const step = (name: string, detail: string) => console.log(`ok  ${name.padEnd(8)} ${detail}`);

/** What the backend's /near/payments/prepare + /near/relay do, end to end. */
async function signAndRelay(call: Call): Promise<TxOutcome> {
  const prepared = await chain.prepare(senderId!, sender.getPublicKey().toString(), call);
  assertRelayable(prepared, policy);
  const signed = await signPrepared(prepared, async (hash) => sender.sign(hash).signature);
  const outcome = await chain.relay(await verifySignedDelegate(prepared, signed));
  assert.equal(outcome.failure, null, `relayed transaction failed: ${outcome.failure} ${chain.txUrl(outcome.txHash)}`);
  return outcome;
}

function holdId(outcome: TxOutcome): string {
  const hold = outcome.events.find((event) => event.event === "hold");
  const id = hold?.data[0]?.id;
  assert.ok(id !== undefined, `no hold event in ${chain.txUrl(outcome.txHash)}`);
  return String(id);
}

async function main() {
  const balance = await chain.usdcBalance(senderId!);
  if (balance < 2n * AMOUNT) {
    throw new Error(`${senderId} has ${balance} USDC base units; needs ${2n * AMOUNT}. Get test USDC at faucet.circle.com (NEAR Testnet).`);
  }
  const tag = `live${Date.now().toString(36)}`;

  // 1. Hold for a handle that has never signed in.
  const waiting = await recipientKeyFor({ username: tag });
  const held = await signAndRelay(
    holdTransfer(config.usdcContract, config.escrowContract, {
      amount: AMOUNT.toString(),
      recipient: waiting.key,
      lifetimeSecs: config.claimLifetimeSecs,
    }),
  );
  const heldId = holdId(held);
  assert.equal((await chain.pending(waiting.key)).length, 1);
  step("hold", `payment ${heldId} waits for @${tag}: ${chain.txUrl(held.txHash)}`);

  // 2. The handle signs in: an account whose only key is theirs.
  const accountId = `${tag}.${config.handleParent}`;
  const userKey = KeyPair.fromRandom("ed25519");
  const created = await chain.createHandleAccount(accountId, userKey.getPublicKey().toString());
  await chain.registerForUsdc(accountId);
  step("account", `${accountId}: ${chain.txUrl(created)}`);

  // 3. The proof: one key, theirs, none of Selkie's.
  const keys = await chain.listKeys(accountId);
  assert.deepEqual(
    keys.map((key) => key.publicKey),
    [userKey.getPublicKey().toString()],
  );
  const ours = new Set(chain.selkieKeys());
  assert.ok(keys.every((key) => !ours.has(key.publicKey)), "a Selkie key is on the user's account");
  step("proof", `1 key, the user's; Selkie holds none: ${chain.accountUrl(accountId)}`);

  // 4. The oracle releases what was waiting.
  const claimed = await chain.claim(waiting.key, accountId);
  assert.equal(claimed.failure, null, `claim failed: ${claimed.failure}`);
  assert.ok(claimed.events.some((event) => event.event === "claim"), "no claim event");
  assert.equal(await chain.usdcBalance(accountId), AMOUNT);
  assert.equal(await chain.getPayment(heldId), null);
  assert.equal((await chain.pending(waiting.key)).length, 0);
  step("claim", `0.01 USDC landed in ${accountId}: ${chain.txUrl(claimed.txHash)}`);

  // 5. Money nobody claimed goes back to its sender once the wait is over.
  const unclaimed = await recipientKeyFor({ username: `${tag}x` });
  const shortHold = await signAndRelay(
    holdTransfer(config.usdcContract, config.escrowContract, {
      amount: AMOUNT.toString(),
      recipient: unclaimed.key,
      lifetimeSecs: 1,
    }),
  );
  const shortId = holdId(shortHold);
  const before = await chain.usdcBalance(senderId!);
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const refunded = await signAndRelay(refundCall(config.escrowContract, shortId));
  assert.ok(refunded.events.some((event) => event.event === "refund"), "no refund event");
  assert.equal(await chain.getPayment(shortId), null);
  assert.equal(await chain.usdcBalance(senderId!), before + AMOUNT);
  step("refund", `payment ${shortId} back with ${senderId}: ${chain.txUrl(refunded.txHash)}`);

  console.log("\nall live NEAR checks passed");
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
