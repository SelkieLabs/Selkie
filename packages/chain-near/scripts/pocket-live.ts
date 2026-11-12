/**
 * The pocket, live on testnet: what the bot can and cannot do.
 *
 *   npm run test:live:near:pocket -- [recipient.x.selkiepay.testnet]
 *
 * Guards (no USDC needed):
 *  1. The bot's key cannot call pocket_withdraw, cannot touch USDC, cannot
 *     move its own NEAR: the access key refuses before anything runs.
 *  2. On chain, the contract refuses pocket_send to an account that is not a
 *     Selkie handle account, pocket_send from anyone but the bot, and a fake
 *     top-up from a contract that is not USDC.
 *
 * Money (needs 1 USDC in NEAR_ROOT_ACCOUNT, which owns the test pocket):
 *  3. top up 1 USDC with a daily cap of 0.5;
 *  4. the bot sends 0.3 to the recipient (an existing handle account,
 *     registered on USDC), whose balance rises by exactly that;
 *  5. a send over what is left of today's cap fails, and nothing moves;
 *  6. the owner withdraws the rest.
 *
 * Run `npm run near:deploy-pocket` first. Testnet only.
 */
import assert from "node:assert/strict";
import { Account, actions, type JsonRpcProvider, type KeyPairString } from "near-api-js";
import { nearConfigFromEnv } from "../src/config";
import { firstFailure, type Call } from "../src/escrow";
import { getPocket, isHandleAccount, pocketSend, pocketTopUp, pocketWithdraw } from "../src/pocket";
import { failoverProvider } from "../src/rpc";

const TOP_UP = 1_000_000n; // 1 USDC
const CAP = 500_000n; // 0.5 USDC
const FIRST_SEND = 300_000n; // 0.3 USDC
const TGAS = 1_000_000_000_000n;

const config = nearConfigFromEnv();
if (config.network !== "testnet") throw new Error("The pocket live test is testnet only.");
const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} missing from .env (run npm run near:deploy-pocket)`);
  return value;
};
const pocketId = env("NEAR_POCKET_CONTRACT");
const botId = env("NEAR_POCKET_BOT_ACCOUNT");
const botKey = env("NEAR_POCKET_BOT_KEY") as KeyPairString;
const root = env("NEAR_ROOT_ACCOUNT");
const recipient = process.argv[2] ?? `paymesh.${config.handleParent}`;

const provider: JsonRpcProvider = failoverProvider(config.rpcUrls ?? [config.rpcUrl]);
const owner = new Account(root, provider, env("NEAR_ROOT_KEY") as KeyPairString);
const bot = new Account(botId, provider, botKey);
const tx = (hash: string) => `${config.explorerUrl}/transactions/${hash}`;
const step = (name: string, text: string) => console.log(`${name.padEnd(9)} ${text}`);

async function usdcBalance(accountId: string): Promise<bigint> {
  return BigInt((await provider.callFunction({ contractId: config.usdcContract, method: "ft_balance_of", args: { account_id: accountId } })) as string);
}

/** Sign and send a prepared call; reports a failed receipt instead of throwing. */
async function send(account: Account, call: Call): Promise<{ hash: string; failure: string | null }> {
  const result = await account.signAndSendTransaction({
    receiverId: call.receiverId,
    actions: call.calls.map((c) =>
      actions.functionCall(c.methodName, new TextEncoder().encode(c.argsJson), BigInt(c.gas), BigInt(c.deposit)),
    ),
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  return { hash: result.transaction.hash, failure: firstFailure(result) };
}

function raw(receiverId: string, methodName: string, args: unknown, deposit = 0n): Call {
  return { receiverId, calls: [{ methodName, argsJson: JSON.stringify(args), gas: (50n * TGAS).toString(), deposit: deposit.toString() }] };
}

/** The bot's key must be refused before the transaction exists. */
async function refusedByKey(what: string, attempt: () => Promise<unknown>) {
  try {
    await attempt();
  } catch (error) {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    step("refused", `${what}: ${text.slice(0, 140)}`);
    return;
  }
  throw new Error(`${what} went through; the bot key is not limited to pocket_send`);
}

async function refusedOnChain(what: string, result: { hash: string; failure: string | null }, reason: RegExp) {
  assert.ok(result.failure, `${what} should have failed`);
  assert.match(result.failure, reason);
  step("refused", `${what}: ${reason.source} ${tx(result.hash)}`);
}

async function main() {
  assert.ok(isHandleAccount(recipient, config.handleParent), `${recipient} is not a handle account`);
  const registered = await provider.callFunction({ contractId: config.usdcContract, method: "storage_balance_of", args: { account_id: recipient } });
  assert.ok(registered, `${recipient} is not registered on USDC; pick another handle account`);

  // 1. the key
  await refusedByKey("bot calls pocket_withdraw", () => send(bot, raw(pocketId, "pocket_withdraw", {})));
  await refusedByKey("bot calls USDC ft_transfer", () =>
    send(bot, raw(config.usdcContract, "ft_transfer", { receiver_id: botId, amount: "1" }, 1n)),
  );
  await refusedByKey("bot calls USDC with no deposit", () =>
    send(bot, raw(config.usdcContract, "storage_unregister", {})),
  );
  await refusedByKey("bot moves its own NEAR", () => bot.transfer({ receiverId: root, amount: 1n }));

  // 2. the contract
  const notHandle = await pocketSend({ provider, pocket: pocketId, botAccount: botId, botKey, owner: root, to: root, amount: "1" });
  assert.equal(notHandle.ok, false);
  await refusedOnChain("bot pays a non-handle account", { hash: notHandle.txHash, failure: notHandle.failure }, /can only send to a Selkie handle account/);
  await refusedOnChain(
    "the owner calls pocket_send",
    await send(owner, raw(pocketId, "pocket_send", { owner: root, to: recipient, amount: "1" })),
    /only the bot can send from a pocket/,
  );
  await refusedOnChain(
    "a fake token tops up",
    await send(owner, raw(pocketId, "ft_on_transfer", { sender_id: root, amount: "1000000", msg: '{"kind":"top_up"}' })),
    /only the pocket's token can top up/,
  );

  // 3-6. money
  const ownerUsdc = await usdcBalance(root);
  if (ownerUsdc < TOP_UP) {
    console.log(
      `\nSKIPPED the money path: ${root} holds ${ownerUsdc} USDC base units and needs ${TOP_UP}. ` +
        `Send it 1 test USDC (faucet.circle.com, NEAR Testnet) and run this again.`,
    );
    process.exit(2);
  }

  const topUp = await send(owner, pocketTopUp(config.usdcContract, pocketId, { amount: TOP_UP.toString(), dailyCap: CAP.toString() }));
  assert.equal(topUp.failure, null, topUp.failure ?? "");
  let pocket = await getPocket(provider, pocketId, root);
  assert.ok(pocket);
  assert.equal(pocket.dailyCap, CAP.toString());
  step("top up", `1 USDC, cap 0.5: ${JSON.stringify(pocket)} ${tx(topUp.hash)}`);

  const first = BigInt(pocket.leftToday) < FIRST_SEND ? BigInt(pocket.leftToday) : FIRST_SEND;
  assert.ok(first > 0n, "nothing left of today's cap; run again tomorrow (UTC)");
  const before = await usdcBalance(recipient);
  const sent = await pocketSend({ provider, pocket: pocketId, botAccount: botId, botKey, owner: root, to: recipient, amount: first.toString(), memo: "Selkie pocket live test" });
  assert.equal(sent.ok, true, sent.failure ?? "");
  assert.equal(await usdcBalance(recipient), before + first);
  pocket = (await getPocket(provider, pocketId, root))!;
  step("send", `${first} to ${recipient} (${before} -> ${before + first}); left today ${pocket.leftToday} ${tx(sent.txHash)}`);

  const over = BigInt(pocket.leftToday) + 1n;
  const balanceBefore = pocket.balance;
  const refused = await pocketSend({ provider, pocket: pocketId, botAccount: botId, botKey, owner: root, to: recipient, amount: over.toString() });
  assert.equal(refused.ok, false);
  await refusedOnChain(`bot sends ${over}, over the cap`, { hash: refused.txHash, failure: refused.failure }, /over the pocket's daily cap/);
  assert.equal((await getPocket(provider, pocketId, root))!.balance, balanceBefore);
  assert.equal(await usdcBalance(recipient), before + first);

  const ownerBefore = await usdcBalance(root);
  const withdrawn = await send(owner, pocketWithdraw(pocketId, {}));
  assert.equal(withdrawn.failure, null, withdrawn.failure ?? "");
  assert.equal(await usdcBalance(root), ownerBefore + BigInt(balanceBefore));
  assert.equal((await getPocket(provider, pocketId, root))!.balance, "0");
  step("withdraw", `${balanceBefore} back to ${root} ${tx(withdrawn.hash)}`);
  console.log("\nAll pocket checks passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
