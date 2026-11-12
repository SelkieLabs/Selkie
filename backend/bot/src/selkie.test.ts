import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_BOT_SECRET_LENGTH } from "@selkie/core";
import { SelkieClient } from "./selkie";
import type { Sender } from "./selkie";

const SECRET = "s".repeat(MIN_BOT_SECRET_LENGTH);

function sender(messageId: string): Sender {
  return { platform: "x", subject: "111", username: "amaka", messageId };
}

/** A client whose calls are recorded rather than sent. */
function record() {
  const calls: { path: string; key: string | null; body: unknown }[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      path: new URL(String(url)).pathname,
      key: headers.get("idempotency-key"),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({ status: "confirmed", ref: "r", message: "Sent." }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return { calls, restore: () => void (globalThis.fetch = original) };
}

const client = new SelkieClient({ baseUrl: "http://api.test", botSecret: SECRET });
const payment = { to: "bo", amount: "5", asset: "USDC" };

describe("what a payment is keyed on", () => {
  it("gives two different posts two different keys", async () => {
    // The bug this exists to stop. The key used to be platform, payee and
    // sender, with no reference to the message at all, so the FIRST payment
    // between two people worked and every one after it, of any amount, came
    // back with the first one's answer. Selkie replied "Sent!" and moved
    // nothing, twice, before anybody noticed: the reply looked like success.
    const { calls, restore } = record();
    try {
      await client.send(sender("post-1"), payment);
      await client.send(sender("post-2"), { ...payment, amount: "9" });
    } finally {
      restore();
    }

    assert.notEqual(calls[0]?.key, calls[1]?.key, "two posts collapsed into one payment");
  });

  it("gives the same post the same key however often it is read", async () => {
    // The case the key is FOR: a poll overlapping a retry reads one post twice,
    // and the second read must not pay again.
    const { calls, restore } = record();
    try {
      await client.send(sender("post-1"), payment);
      await client.send(sender("post-1"), payment);
    } finally {
      restore();
    }

    assert.equal(calls[0]?.key, calls[1]?.key);
  });

  it("does not key on the amount or the payee, which two real payments share", async () => {
    const { calls, restore } = record();
    try {
      await client.send(sender("post-1"), payment);
    } finally {
      restore();
    }

    const key = calls[0]?.key ?? "";
    assert.doesNotMatch(key, /\bbo\b/, "keyed on the payee, so a second payment to them is lost");
    assert.doesNotMatch(key, /\b5\b/, "keyed on the amount");
    assert.match(key, /post-1/, "and does carry the post it came from");
  });

  it("keys a request on its post too", async () => {
    const { calls, restore } = record();
    try {
      await client.request(sender("post-1"), { from: "bo", amount: "5", asset: "USDC" });
      await client.request(sender("post-2"), { from: "bo", amount: "5", asset: "USDC" });
    } finally {
      restore();
    }

    assert.ok(calls[0]?.key, "a request with no key can be duplicated by a retry");
    assert.notEqual(calls[0]?.key, calls[1]?.key);
  });
});

describe("sending from an X pocket (NEAR)", () => {
  it("asks /near/bot/send as the bot, with the secret, keyed on the post and its author", async () => {
    const seen: { path: string; headers: Headers; body: unknown }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ path: new URL(String(url)).pathname, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ status: "no-pocket" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const result = await client.pocketSend(sender("post-9"), { to: "bo", amount: "2", note: "for lunch" });
      assert.deepEqual(result, { status: "no-pocket" });
    } finally {
      globalThis.fetch = original;
    }

    assert.equal(seen[0]?.path, "/near/bot/send");
    assert.equal(seen[0]?.headers.get("x-selkie-bot-secret"), SECRET);
    assert.equal(seen[0]?.headers.get("authorization"), null, "not made as the person: nobody's account is signed for");
    assert.deepEqual(seen[0]?.body, {
      tweetId: "post-9",
      senderXUserId: "111",
      senderHandle: "amaka",
      to: "bo",
      amount: "2",
      note: "for lunch",
    });
  });

  it("turns a refusal into the API's own words", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "That is not the bot." }), { status: 401 })) as typeof fetch;
    try {
      await assert.rejects(client.pocketSend(sender("post-9"), { to: "bo", amount: "2" }), /not the bot/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
