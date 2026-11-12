import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { PaycrestClient, PaycrestError, multiplyDecimal, paycrestWords } from "./paycrest";

type Seen = { url: string; init?: RequestInit };

function fakeFetch(answers: Array<{ status: number; body: unknown }>, seen: Seen[] = []) {
  return (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    const text = typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return new Response(text, { status: next.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const keyed = { apiKey: "test-key", apiSecret: "test-secret", refundAddress: "0xrefund", network: "base" };

test("rate: the sell rate for USDC on the configured network, read as a string", async () => {
  const seen: Seen[] = [];
  const client = new PaycrestClient({
    fetch: fakeFetch(
      [
        {
          status: 200,
          // As the live API answered on 12 Nov 2026.
          body: {
            status: "success",
            message: "Rate fetched successfully",
            data: { sell: { rate: "1398.05", providerIds: ["YyPrHKaI", "WYjUQLBk"], orderType: "regular", refundTimeoutMinutes: 2 } },
          },
        },
      ],
      seen,
    ),
  });
  const rate = await client.rate("10", "NGN");
  assert.deepEqual(rate, { rate: "1398.05", providerIds: ["YyPrHKaI", "WYjUQLBk"] });
  assert.equal(seen[0]!.url, "https://api.paycrest.io/v2/rates/base/USDC/10/NGN?side=sell");
  // Public: no key goes out.
  assert.equal((seen[0]!.init?.headers as Record<string, string>)["API-Key"], undefined);
});

test("rate: no provider is Paycrest's own words, and a missing rate is refused", async () => {
  const client = new PaycrestClient({
    fetch: fakeFetch([
      { status: 404, body: { status: "error", message: "no provider available for USDC to NGN conversion with amount 90000 on base", data: null } },
      { status: 200, body: { status: "success", data: { buy: { rate: "1500" } } } },
    ]),
  });
  await assert.rejects(client.rate("90000", "NGN"), /no provider available/);
  await assert.rejects(client.rate("10", "NGN"), /no rate/);
});

test("banks: Paycrest's list, cached per currency", async () => {
  const seen: Seen[] = [];
  const client = new PaycrestClient({
    fetch: fakeFetch(
      [
        {
          status: 200,
          body: {
            status: "success",
            message: "OK",
            data: [
              { name: "Guaranty Trust Bank", code: "GTBINGLA", type: "bank" },
              { name: "Access Bank", code: "ABNGNGLA", type: "bank" },
              { nonsense: true },
            ],
          },
        },
      ],
      seen,
    ),
  });
  const first = await client.institutions("NGN");
  const again = await client.institutions("NGN");
  assert.equal(seen.length, 1);
  assert.deepEqual(again, first);
  assert.deepEqual(first.map((bank) => bank.code), ["GTBINGLA", "ABNGNGLA"]);
});

test("verify: the holder's name, null when Paycrest can only say OK, its refusal otherwise", async () => {
  const seen: Seen[] = [];
  const client = new PaycrestClient({
    fetch: fakeFetch(
      [
        { status: 200, body: { status: "success", message: "Account name was resolved successfully", data: "AMAKA OKAFOR" } },
        { status: 200, body: { status: "success", message: "OK", data: "OK" } },
        { status: 400, body: { status: "error", message: "Account could not be verified", data: null } },
        { status: 504, body: "error code: 504" },
      ],
      seen,
    ),
  });
  assert.deepEqual(await client.verifyAccount("GTBINGLA", "0123456789"), { accountName: "AMAKA OKAFOR" });
  assert.equal(seen[0]!.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(seen[0]!.init?.body)), { institution: "GTBINGLA", accountIdentifier: "0123456789" });
  assert.deepEqual(await client.verifyAccount("SAFAKEPC", "0712345678"), { accountName: null });
  await assert.rejects(client.verifyAccount("GTBINGLA", "1"), (error: unknown) => {
    assert.ok(error instanceof PaycrestError);
    assert.equal(error.message, "Account could not be verified");
    assert.equal(error.status, 400);
    return true;
  });
  // A gateway error page, not JSON: a plain line, not a crash.
  await assert.rejects(client.verifyAccount("GTBINGLA", "2"), /did not answer/);
});

test("order: the v2 body Paycrest documents, with the key, and the address and amount to pay", async () => {
  const seen: Seen[] = [];
  const client = new PaycrestClient({
    ...keyed,
    fetch: fakeFetch(
      [
        {
          status: 201,
          body: {
            status: "success",
            message: "Payment order initiated successfully",
            data: {
              id: "order-1",
              status: "initiated",
              rate: "1398.05",
              senderFee: "0",
              transactionFee: "0.05",
              reference: "selkie-abc",
              providerAccount: {
                network: "base",
                receiveAddress: "0xreceive",
                validUntil: "2026-11-12T18:30:00Z",
                amountToTransfer: "10.05",
                currency: "USDC",
              },
            },
          },
        },
      ],
      seen,
    ),
  });
  const order = await client.createOrder({
    amount: "10",
    currency: "NGN",
    institution: "GTBINGLA",
    accountIdentifier: "0123456789",
    accountName: "AMAKA OKAFOR",
    reference: "selkie-abc",
  });
  assert.equal(order.providerAccount.receiveAddress, "0xreceive");
  assert.equal(order.providerAccount.amountToTransfer, "10.05");
  assert.equal(seen[0]!.url, "https://api.paycrest.io/v2/sender/orders");
  assert.equal((seen[0]!.init?.headers as Record<string, string>)["API-Key"], "test-key");
  assert.deepEqual(JSON.parse(String(seen[0]!.init?.body)), {
    amount: "10",
    amountIn: "crypto",
    reference: "selkie-abc",
    source: { type: "crypto", currency: "USDC", network: "base", refundAddress: "0xrefund" },
    destination: {
      type: "fiat",
      currency: "NGN",
      recipient: { institution: "GTBINGLA", accountIdentifier: "0123456789", accountName: "AMAKA OKAFOR", memo: "Selkie cash out" },
    },
  });
});

test("order: a refusal comes back in Paycrest's words, field errors included; no key means no call", async () => {
  const seen: Seen[] = [];
  const client = new PaycrestClient({
    ...keyed,
    fetch: fakeFetch(
      [
        { status: 403, body: { status: "error", message: "Complete your business verification to start initiating payment orders", data: null } },
        {
          status: 400,
          body: { status: "error", message: "Failed to validate payload", data: [{ field: "Amount", message: "Amount is required" }] },
        },
        { status: 201, body: { status: "success", data: { id: "order-2", status: "initiated", providerAccount: {} } } },
      ],
      seen,
    ),
  });
  const input = { amount: "10", currency: "NGN" as const, institution: "GTBINGLA", accountIdentifier: "1", accountName: "A", reference: "r" };
  await assert.rejects(client.createOrder(input), /Complete your business verification/);
  await assert.rejects(client.createOrder(input), /Failed to validate payload \(Amount: Amount is required\)/);
  await assert.rejects(client.createOrder(input), /without somewhere to pay it/);

  const unkeyed = new PaycrestClient({ refundAddress: "0xrefund", fetch: fakeFetch([], seen) });
  const before = seen.length;
  assert.equal(unkeyed.canPay, false);
  await assert.rejects(unkeyed.createOrder(input), /aren't switched on/);
  assert.equal(seen.length, before);
  assert.equal(new PaycrestClient({ apiKey: "k" }).canPay, false, "a key without a refund address is not enough");
});

test("get order: by id, with the key", async () => {
  const seen: Seen[] = [];
  const client = new PaycrestClient({
    ...keyed,
    fetch: fakeFetch([{ status: 200, body: { status: "success", data: { id: "order-1", status: "settled", txHash: "0xabc" } } }], seen),
  });
  const order = await client.getOrder("order-1");
  assert.equal(order.status, "settled");
  assert.equal(seen[0]!.url, "https://api.paycrest.io/v2/sender/orders/order-1");
  assert.equal((seen[0]!.init?.headers as Record<string, string>)["API-Key"], "test-key");
});

test("webhook signature: the hex HMAC of the raw body with the secret; anything else is refused", () => {
  const client = new PaycrestClient(keyed);
  const raw = '{"event":"payment_order.settled","webhookVersion":"2","data":{"id":"order-1","status":"settled"}}';
  const good = createHmac("sha256", "test-secret").update(raw).digest("hex");
  assert.equal(client.verifySignature(raw, good), true);
  assert.equal(client.verifySignature(Buffer.from(raw), ` ${good.toUpperCase()} `), true, "case and spaces do not matter");
  assert.equal(client.verifySignature(raw, createHmac("sha256", "wrong-secret").update(raw).digest("hex")), false);
  assert.equal(client.verifySignature(raw.replace("settled", "refunded"), good), false, "a changed body fails");
  assert.equal(client.verifySignature(raw, good.slice(0, 10)), false);
  assert.equal(client.verifySignature(raw, undefined), false);
  assert.equal(new PaycrestClient({}).verifySignature(raw, good), false, "no secret, nothing verifies");
});

test("amount times rate, cut not rounded, no floats", () => {
  assert.equal(multiplyDecimal("10", "1398.05"), "13980.50");
  assert.equal(multiplyDecimal("0.1", "1398.05"), "139.80");
  assert.equal(multiplyDecimal("2.333333", "3"), "6.99");
  assert.equal(multiplyDecimal("12.5", "2626.5", 0), "32831");
});

test("words: Paycrest's message first, a plain line when there is none", () => {
  assert.equal(paycrestWords(503, { message: "No provider available for this corridor" }), "No provider available for this corridor");
  assert.equal(paycrestWords(401, null), "Paycrest did not accept Selkie's key.");
  assert.equal(paycrestWords(502, {}), "Paycrest did not answer just now. Try again in a moment.");
});
