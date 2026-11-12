import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_POCKET_CAP_UNITS, isHandleAccount, pocketSetCap, pocketTopUp, pocketWithdraw } from "./pocket";

const USDC = "usdc.test";
const POCKET = "pocket.selkiepay.testnet";
const PARENT = "x.selkiepay.testnet";

const args = (argsJson: string) => JSON.parse(argsJson) as Record<string, unknown>;

test("the default cap is 10 USDC", () => {
  assert.equal(DEFAULT_POCKET_CAP_UNITS, 10_000_000n);
});

test("a top-up is one ft_transfer_call to the pocket with a top_up msg and 1 yocto", () => {
  const call = pocketTopUp(USDC, POCKET, { amount: "5000000" });
  assert.equal(call.receiverId, USDC);
  assert.equal(call.calls.length, 1);
  const [only] = call.calls;
  assert.equal(only!.methodName, "ft_transfer_call");
  assert.equal(only!.deposit, "1");
  assert.equal(only!.gas, "100000000000000");
  assert.deepEqual(args(only!.argsJson), { receiver_id: POCKET, amount: "5000000", msg: '{"kind":"top_up"}' });
});

test("a top-up can set the daily cap, including 0", () => {
  const capped = pocketTopUp(USDC, POCKET, { amount: "1000000", dailyCap: "500000" });
  assert.equal(args(capped.calls[0]!.argsJson).msg, '{"kind":"top_up","daily_cap":"500000"}');
  const paused = pocketTopUp(USDC, POCKET, { amount: "1000000", dailyCap: "0" });
  assert.equal(args(paused.calls[0]!.argsJson).msg, '{"kind":"top_up","daily_cap":"0"}');
});

test("builders refuse decimals, junk and zero amounts", () => {
  assert.throws(() => pocketTopUp(USDC, POCKET, { amount: "1.5" }), /base units/);
  assert.throws(() => pocketTopUp(USDC, POCKET, { amount: "0" }), /more than zero/);
  assert.throws(() => pocketTopUp(USDC, POCKET, { amount: "-1" }), /base units/);
  assert.throws(() => pocketTopUp(USDC, POCKET, { amount: "1", dailyCap: "ten" }), /base units/);
  assert.throws(() => pocketWithdraw(POCKET, { amount: "0" }), /more than zero/);
  assert.throws(() => pocketSetCap(POCKET, { dailyCap: "1e6" }), /base units/);
});

test("leading zeros are normalised so the signed args are canonical", () => {
  const call = pocketTopUp(USDC, POCKET, { amount: "0005" });
  assert.equal(args(call.calls[0]!.argsJson).amount, "5");
});

test("withdraw: everything when no amount, else the amount; 1 yocto either way", () => {
  const all = pocketWithdraw(POCKET, {});
  assert.equal(all.receiverId, POCKET);
  assert.equal(all.calls[0]!.methodName, "pocket_withdraw");
  assert.equal(all.calls[0]!.argsJson, "{}");
  assert.equal(all.calls[0]!.deposit, "1");
  const some = pocketWithdraw(POCKET, { amount: "2000000" });
  assert.deepEqual(args(some.calls[0]!.argsJson), { amount: "2000000" });
});

test("set cap calls pocket_set_cap with 1 yocto", () => {
  const call = pocketSetCap(POCKET, { dailyCap: "10000000" });
  assert.equal(call.receiverId, POCKET);
  assert.equal(call.calls[0]!.methodName, "pocket_set_cap");
  assert.equal(call.calls[0]!.deposit, "1");
  assert.deepEqual(args(call.calls[0]!.argsJson), { daily_cap: "10000000" });
});

test("only direct children of the handle parent are handle accounts", () => {
  assert.equal(isHandleAccount("amaka.x.selkiepay.testnet", PARENT), true);
  assert.equal(isHandleAccount("tunde_9-1234.x.selkiepay.testnet", PARENT), true);
  assert.equal(isHandleAccount("x123456.x.selkiepay.testnet", PARENT), true);

  assert.equal(isHandleAccount("evil.testnet", PARENT), false);
  assert.equal(isHandleAccount("a.b.x.selkiepay.testnet", PARENT), false);
  assert.equal(isHandleAccount("x.selkiepay.testnet", PARENT), false);
  assert.equal(isHandleAccount(".x.selkiepay.testnet", PARENT), false);
  assert.equal(isHandleAccount("amakax.selkiepay.testnet", PARENT), false);
  assert.equal(isHandleAccount("Amaka.x.selkiepay.testnet", PARENT), false);
  assert.equal(isHandleAccount("amaka.x.selkiepay.testnet.evil.testnet", PARENT), false);
  assert.equal(isHandleAccount("pocket.selkiepay.testnet", PARENT), false);
});
