import assert from "node:assert/strict";
import { test } from "node:test";
import { IntentsError, OneClickClient, chainAssets, exactOutputRequest, nearUsdc, quoteRequest, type OneClickToken } from "./intents";

// Shapes as /v0/tokens sent them on 11 Nov 2026.
const TOKENS: OneClickToken[] = [
  { assetId: "nep141:mainnet-usdc", decimals: 6, blockchain: "near", symbol: "USDC", contractAddress: "17208628" },
  { assetId: "nep141:usdt.tether-token.near", decimals: 6, blockchain: "near", symbol: "USDT", contractAddress: "usdt.tether-token.near" },
  { assetId: "nep141:base-usdc", decimals: 6, blockchain: "base", symbol: "USDC", contractAddress: "0x8335" },
  { assetId: "nep141:tron-usdt", decimals: 6, blockchain: "tron", symbol: "USDT", contractAddress: "TR7N" },
  { assetId: "nep141:bnb-usdt", decimals: 18, blockchain: "bsc", symbol: "USDT", contractAddress: "0x55d3" },
  { assetId: "nep141:eth-weth", decimals: 18, blockchain: "eth", symbol: "ETH" },
  { assetId: "nep245:stellar-usdc", decimals: 7, blockchain: "stellar", symbol: "USDC" },
  { assetId: "nep141:arb-usdt0", decimals: 6, blockchain: "arb", symbol: "USDT0" },
];

test("offered assets: stablecoins on other chains, in a fixed order, nothing on NEAR or Stellar", () => {
  assert.deepEqual(
    chainAssets(TOKENS).map((asset) => `${asset.chainName} ${asset.symbol}`),
    ["Base USDC", "Tron USDT", "BNB Chain USDT"],
  );
});

test("USDC on NEAR: the exact contract on mainnet, mainnet's stand-in only on testnet", () => {
  assert.equal(nearUsdc(TOKENS, "17208628", "mainnet")?.assetId, "nep141:mainnet-usdc");
  assert.equal(nearUsdc(TOKENS, "some-other-usdc", "mainnet"), null);
  assert.equal(nearUsdc(TOKENS, "3e2210e1", "testnet")?.assetId, "nep141:mainnet-usdc");
});

const [base, , bsc] = chainAssets(TOKENS);
const usdc = TOKENS[0]!;
const now = Date.parse("2026-11-11T21:00:00Z");

test("money in: their coin on the other chain is deposited, USDC lands in the NEAR account", () => {
  const request = quoteRequest({ direction: "in", asset: bsc!, usdc, amount: "10", nearAccount: "amaka.near", externalAddress: " 0xabc ", dry: true, now });
  assert.equal(request.originAsset, "nep141:bnb-usdt");
  assert.equal(request.destinationAsset, "nep141:mainnet-usdc");
  // BNB Chain USDT has 18 decimals: the amount is in the coin being deposited.
  assert.equal(request.amount, "10000000000000000000");
  assert.equal(request.recipient, "amaka.near");
  assert.equal(request.refundTo, "0xabc");
  assert.equal(request.deadline, "2026-11-11T21:10:00.000Z");
  assert.equal(request.swapType, "EXACT_INPUT");
  assert.equal(request.dry, true);
});

test("money out: USDC leaves the NEAR account, a failed swap refunds to it", () => {
  const request = quoteRequest({ direction: "out", asset: base!, usdc, amount: "2.5", nearAccount: "amaka.near", externalAddress: "0xdef", dry: false, now });
  assert.equal(request.originAsset, "nep141:mainnet-usdc");
  assert.equal(request.destinationAsset, "nep141:base-usdc");
  assert.equal(request.amount, "2500000");
  assert.equal(request.recipient, "0xdef");
  assert.equal(request.refundTo, "amaka.near");
});

test("a bad amount or a missing address is refused before 1Click is asked", () => {
  const base_ = { asset: base!, usdc, nearAccount: "a.near", dry: true, now };
  assert.throws(() => quoteRequest({ ...base_, direction: "in", amount: "0", externalAddress: "0x1" }), IntentsError);
  assert.throws(() => quoteRequest({ ...base_, direction: "in", amount: "1.1234567", externalAddress: "0x1" }), /decimal places/);
  assert.throws(() => quoteRequest({ ...base_, direction: "out", amount: "1", externalAddress: "  " }), /address to send to/);
});

test("exact output: a set amount must arrive, so 1Click sizes the deposit and refunds the rest to NEAR", () => {
  const deadline = now + 5 * 60_000;
  const request = exactOutputRequest({ asset: base!, usdc, amountOut: 10_050_000n, nearAccount: "amaka.near", externalAddress: " 0xpaycrest ", dry: false, now, deadline });
  assert.equal(request.swapType, "EXACT_OUTPUT");
  assert.equal(request.originAsset, "nep141:mainnet-usdc");
  assert.equal(request.destinationAsset, "nep141:base-usdc");
  assert.equal(request.amount, "10050000");
  assert.equal(request.recipient, "0xpaycrest");
  assert.equal(request.refundTo, "amaka.near");
  assert.equal(request.deadline, "2026-11-11T21:05:00.000Z");
  assert.throws(() => exactOutputRequest({ asset: base!, usdc, amountOut: 0n, nearAccount: "a.near", externalAddress: "0x1", dry: true, now }), IntentsError);
  assert.throws(() => exactOutputRequest({ asset: base!, usdc, amountOut: 1n, nearAccount: "a.near", externalAddress: " ", dry: true, now }), /address/);
});

function fakeFetch(answers: Array<{ status: number; body: unknown }>, seen: Array<{ url: string; init?: RequestInit }>) {
  return (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    const next = answers.shift()!;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("the client: tokens are cached, the JWT is sent, 1Click's refusals become plain words", async () => {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  let clock = now;
  const client = new OneClickClient({
    baseUrl: "https://1click.test/",
    jwt: "secret-jwt",
    now: () => clock,
    fetch: fakeFetch(
      [
        { status: 200, body: TOKENS },
        { status: 400, body: { message: "refundTo is not valid" } },
        { status: 400, body: { message: "Temporary swap limits: minimum swap amount is $100" } },
        { status: 500, body: { message: "Internal server error" } },
        { status: 200, body: { quote: { amountIn: "1", amountInFormatted: "1", amountOut: "1", amountOutFormatted: "1" } } },
      ],
      seen,
    ),
  });

  assert.equal((await client.tokens()).length, TOKENS.length);
  clock += 60_000;
  await client.tokens();
  assert.equal(seen.length, 1, "a second read within five minutes is cached");
  assert.equal(seen[0]!.url, "https://1click.test/v0/tokens");
  assert.equal((seen[0]!.init?.headers as Record<string, string>).authorization, "Bearer secret-jwt");

  const request = quoteRequest({ direction: "in", asset: base!, usdc, amount: "5", nearAccount: "a.near", externalAddress: "0x1", dry: false, now });
  await assert.rejects(client.quote(request), { message: "That refund address doesn't look right for that chain.", status: 400 });
  await assert.rejects(client.quote(request), { message: "Temporary swap limits: minimum swap amount is $100" });
  await assert.rejects(client.quote(request), /could not quote that route/);
  // A committed quote without a deposit address is useless: refuse it rather than show nothing to pay.
  await assert.rejects(client.quote(request), /no deposit address/);
});
