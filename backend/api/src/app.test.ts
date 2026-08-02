import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { StellarAdapter } from "@selkie/chain-stellar";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { FakeIdentityProvider } from "./identity/provider";
import { InMemoryUserStore } from "./identity/store";

/** Minimal chain stand-in: the routes are what is under test here. */
const adapterStub = {
  sent: [] as { to: string; amount: string }[],
  heldForClaim: true,
  async ensureAccount(handle: { platform: string; username: string }) {
    return { chain: "stellar", handle, address: "G_TEST", status: "provisioning" };
  },
  async pendingClaims() {
    return [] as bigint[];
  },
  async waitingFor() {
    return [] as { amount: string; asset: string }[];
  },
  provisioned: [] as string[],
  async ensureReceivable(address: string) {
    adapterStub.provisioned.push(address);
    return { address, accepts: ["USDC", "XLM"] };
  },
  async claim() {
    return { status: "confirmed", ref: "TX" };
  },
  async getBalance(account: unknown) {
    return { account, balances: [{ amount: "12.5", asset: "USDC" }] };
  },
  async send(_from: unknown, to: { username: string }, amount: { amount: string }) {
    adapterStub.sent.push({ to: to.username, amount: amount.amount });
    return { status: "confirmed", ref: "TX_SEND", heldForClaim: adapterStub.heldForClaim };
  },
  async transfer() {
    return { status: "confirmed", ref: "TX_SWEEP" };
  },
};

/** Quotes at a flat 2:1 so the numbers in these tests are obvious. */
const swapStub = {
  id: "test-swap",
  swapped: [] as { amount: string; asset: string; to: string }[],
  async quote(from: { amount: string; asset: string }, toAsset: string) {
    return {
      provider: "test-swap",
      from,
      to: { amount: String(Number(from.amount) * 2), asset: toAsset },
    };
  },
  async swap(
    _account: unknown,
    from: { amount: string; asset: string },
    toAsset: string,
  ) {
    swapStub.swapped.push({ ...from, to: toAsset });
    return { ref: "TX_SWAP" };
  },
};

const xToken = (subject: string, username: string) => `test:x:${subject}:${username}`;
const googleToken = (subject: string) => `test:google:${subject}:`;

describe("api", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    adapterStub.sent = [];
    adapterStub.heldForClaim = true;
    adapterStub.provisioned = [];
    swapStub.swapped = [];
    app = buildApp({
      users: new InMemoryUserStore(),
      provider: new FakeIdentityProvider(true),
      adapter: adapterStub as unknown as StellarAdapter,
      swap: swapStub,
    });
  });

  const post = async (url: string, payload: Record<string, unknown>, token?: string) =>
    await app.inject({
      method: "POST",
      url,
      payload,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  test("health responds", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
  });

  test("an unknown identity gets asked before an account is created", async () => {
    const response = await post("/auth/session", { token: xToken("x1", "amaka") });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().status, "no-account");
  });

  test("confirming creates the account", async () => {
    const response = await post("/auth/session", {
      token: xToken("x1", "amaka"),
      createAccount: true,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "created");
    assert.deepEqual(response.json().user.handles, [{ platform: "x", username: "amaka" }]);
  });

  test("a missing token is rejected, not guessed at", async () => {
    assert.equal((await post("/auth/session", {})).statusCode, 400);
  });

  test("a forged token is unauthorized", async () => {
    const response = await post("/auth/session", { token: "forged", createAccount: true });
    assert.equal(response.statusCode, 401);
  });

  test("protected routes require a bearer token", async () => {
    assert.equal((await app.inject({ method: "GET", url: "/me" })).statusCode, 401);
    assert.equal((await post("/payments/send", { to: "@x", amount: "1" })).statusCode, 401);
  });

  test("the response never leaks provider subjects", async () => {
    const created = await post("/auth/session", {
      token: xToken("x-secret-id", "amaka"),
      createAccount: true,
    });
    assert.equal(created.statusCode, 200);
    assert.ok(!JSON.stringify(created.json()).includes("x-secret-id"));
  });

  test("me returns balances for the signed-in user", async () => {
    const token = xToken("x1", "amaka");
    await post("/auth/session", { token, createAccount: true });

    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().balances, [{ amount: "12.5", asset: "USDC" }]);
  });

  test("sending to a handle that has not joined says it is waiting", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const response = await post("/payments/send", { to: "@amaka", amount: "5" }, token);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().waitingToBeClaimed, true);
    // Plain language, no crypto words. This string reaches a human.
    assert.equal(response.json().message, "Sent. It is waiting for @amaka to claim.");
    assert.deepEqual(adapterStub.sent, [{ to: "amaka", amount: "5" }]);
  });

  test("sending to an existing user just says sent", async () => {
    adapterStub.heldForClaim = false;
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const response = await post("/payments/send", { to: "amaka", amount: "5" }, token);
    assert.equal(response.json().message, "Sent to @amaka.");
    assert.equal(response.json().waitingToBeClaimed, false);
  });

  test("a Google-only user is told to link before sending", async () => {
    const token = googleToken("g1");
    await post("/auth/session", { token, createAccount: true });

    const response = await post("/payments/send", { to: "@amaka", amount: "5" }, token);
    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /Link your X or Telegram/);
  });

  test("an incomplete payment is refused", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });
    assert.equal((await post("/payments/send", { to: "@amaka" }, token)).statusCode, 400);
    assert.equal((await post("/payments/send", { amount: "5" }, token)).statusCode, 400);
  });

  test("linking an identity owned by someone else returns a merge prompt, not a merge", async () => {
    const xTokenValue = xToken("x1", "amaka");
    await post("/auth/session", { token: xTokenValue, createAccount: true });

    const googleTokenValue = googleToken("g1");
    await post("/auth/session", { token: googleTokenValue, createAccount: true });

    const response = await post("/auth/link", { token: xTokenValue }, googleTokenValue);
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().status, "merge-required");
    assert.ok(response.json().mergeCandidate.userId);
  });

  test("a handle nobody has claimed is still a valid destination", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const response = await app.inject({
      method: "GET",
      url: "/handles/@amaka",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().handle, { platform: "x", username: "amaka" });
    assert.equal(response.json().onSelkie, false);
  });

  test("looking up a handle shows the face the sender is about to pay", async () => {
    await post("/auth/session", { token: xToken("x2", "Amaka"), createAccount: true });

    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const response = await app.inject({
      // Typed with different casing than it was registered with, on purpose.
      method: "GET",
      url: "/handles/AMAKA",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.json().onSelkie, true);
    assert.equal(response.json().isYou, false);
  });

  test("paying yourself is flagged before it happens, not after", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const response = await app.inject({
      method: "GET",
      url: "/handles/chidi",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.json().isYou, true);
  });

  test("an empty handle is a question, not a server error", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const response = await app.inject({
      method: "GET",
      url: "/handles/@",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 400);
  });

  test("a Gmail is not a payable destination", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const response = await app.inject({
      method: "GET",
      url: "/handles/amaka?platform=google",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 400);
  });

  test("sending writes a line in the sender's activity", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });
    await post("/payments/send", { to: "@amaka", amount: "5" }, token);

    const response = await app.inject({
      method: "GET",
      url: "/activity",
      headers: { authorization: `Bearer ${token}` },
    });
    const [entry] = response.json().entries;
    assert.equal(entry.kind, "send");
    assert.equal(entry.counterparty, "@amaka");
    assert.deepEqual(entry.amount, { amount: "5", asset: "USDC" });
    // Waiting to be claimed is not the same as arrived.
    assert.equal(entry.status, "pending");
  });

  test("both sides of a settled payment see it in their own feed", async () => {
    adapterStub.heldForClaim = false;
    const recipient = xToken("x2", "amaka");
    await post("/auth/session", { token: recipient, createAccount: true });

    const sender = xToken("x1", "chidi");
    await post("/auth/session", { token: sender, createAccount: true });
    await post("/payments/send", { to: "@amaka", amount: "5" }, sender);

    const feed = await app.inject({
      method: "GET",
      url: "/activity",
      headers: { authorization: `Bearer ${recipient}` },
    });
    const [entry] = feed.json().entries;
    assert.equal(entry.kind, "receive");
    assert.equal(entry.counterparty, "@chidi");
    assert.equal(entry.status, "confirmed");
  });

  test("one person's activity is never another person's", async () => {
    const sender = xToken("x1", "chidi");
    await post("/auth/session", { token: sender, createAccount: true });
    await post("/payments/send", { to: "@amaka", amount: "5" }, sender);

    const stranger = xToken("x9", "stranger");
    await post("/auth/session", { token: stranger, createAccount: true });

    const feed = await app.inject({
      method: "GET",
      url: "/activity",
      headers: { authorization: `Bearer ${stranger}` },
    });
    assert.deepEqual(feed.json().entries, []);
  });

  test("converting quotes first and records what it did", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const quote = await app.inject({
      method: "GET",
      url: "/payments/convert/quote?from=USDC&to=XLM&amount=5",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.deepEqual(quote.json().to, { amount: "10", asset: "XLM" });

    const done = await post("/payments/convert", { from: "usdc", to: "xlm", amount: "5" }, token);
    assert.equal(done.statusCode, 200);
    assert.deepEqual(swapStub.swapped, [{ amount: "5", asset: "USDC", to: "XLM" }]);

    const feed = await app.inject({
      method: "GET",
      url: "/activity",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(feed.json().entries[0].kind, "swap");
  });

  test("an incomplete conversion is refused", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });
    assert.equal((await post("/payments/convert", { from: "USDC" }, token)).statusCode, 400);
  });

  test("activity and lookups need a bearer token too", async () => {
    assert.equal((await app.inject({ method: "GET", url: "/activity" })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/handles/amaka" })).statusCode, 401);
  });

  test("asking for the receive address makes the wallet able to receive", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const response = await post("/me/receive", {}, token);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().address, "G_TEST");
    assert.deepEqual(response.json().accepts, ["USDC", "XLM"]);
    // The point of the route: an address nobody provisioned cannot be paid.
    assert.deepEqual(adapterStub.provisioned, ["G_TEST"]);
  });

  test("asking someone for money moves nothing", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const response = await post("/requests", { from: "@amaka", amount: "20" }, token);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().request.status, "pending");
    assert.deepEqual(adapterStub.sent, []);
  });

  test("a request shows up as outgoing for the asker and incoming for the asked", async () => {
    const asker = xToken("x1", "chidi");
    await post("/auth/session", { token: asker, createAccount: true });
    await post("/requests", { from: "@amaka", amount: "20" }, asker);

    const asked = xToken("x2", "amaka");
    await post("/auth/session", { token: asked, createAccount: true });

    const mine = await app.inject({
      method: "GET",
      url: "/requests",
      headers: { authorization: `Bearer ${asker}` },
    });
    assert.equal(mine.json().outgoing.length, 1);
    assert.equal(mine.json().incoming.length, 0);

    const theirs = await app.inject({
      method: "GET",
      url: "/requests",
      headers: { authorization: `Bearer ${asked}` },
    });
    assert.equal(theirs.json().incoming.length, 1);
    assert.equal(theirs.json().outgoing.length, 0);
  });

  test("only the person a request is addressed to can pay it", async () => {
    adapterStub.heldForClaim = false;
    const asker = xToken("x1", "chidi");
    await post("/auth/session", { token: asker, createAccount: true });
    const { request: asked } = (
      await post("/requests", { from: "@amaka", amount: "20" }, asker)
    ).json();

    // A stranger who somehow knows the id gets the same answer as for a request
    // that does not exist. Knowing an id must never confirm one exists.
    const stranger = xToken("x9", "stranger");
    await post("/auth/session", { token: stranger, createAccount: true });
    const refused = await post(`/requests/${asked.id}/pay`, {}, stranger);
    assert.equal(refused.statusCode, 404);
    assert.deepEqual(adapterStub.sent, []);

    // The asker cannot pay their own request into their own pocket either.
    assert.equal((await post(`/requests/${asked.id}/pay`, {}, asker)).statusCode, 404);

    const amaka = xToken("x2", "amaka");
    await post("/auth/session", { token: amaka, createAccount: true });
    const paid = await post(`/requests/${asked.id}/pay`, {}, amaka);
    assert.equal(paid.statusCode, 200);
    assert.equal(paid.json().request.status, "paid");
    assert.deepEqual(adapterStub.sent, [{ to: "chidi", amount: "20" }]);
  });

  test("a request cannot be paid twice", async () => {
    adapterStub.heldForClaim = false;
    const asker = xToken("x1", "chidi");
    await post("/auth/session", { token: asker, createAccount: true });
    const { request: asked } = (
      await post("/requests", { from: "@amaka", amount: "20" }, asker)
    ).json();

    const amaka = xToken("x2", "amaka");
    await post("/auth/session", { token: amaka, createAccount: true });
    await post(`/requests/${asked.id}/pay`, {}, amaka);

    const again = await post(`/requests/${asked.id}/pay`, {}, amaka);
    assert.equal(again.statusCode, 409);
    assert.equal(adapterStub.sent.length, 1, "the second attempt must not send again");
  });

  test("declining settles a request without paying it", async () => {
    const asker = xToken("x1", "chidi");
    await post("/auth/session", { token: asker, createAccount: true });
    const { request: asked } = (
      await post("/requests", { from: "@amaka", amount: "20" }, asker)
    ).json();

    const amaka = xToken("x2", "amaka");
    await post("/auth/session", { token: amaka, createAccount: true });
    const declined = await post(`/requests/${asked.id}/decline`, {}, amaka);
    assert.equal(declined.json().request.status, "declined");
    assert.deepEqual(adapterStub.sent, []);
  });

  test("only the asker can withdraw their own request", async () => {
    const asker = xToken("x1", "chidi");
    await post("/auth/session", { token: asker, createAccount: true });
    const { request: asked } = (
      await post("/requests", { from: "@amaka", amount: "20" }, asker)
    ).json();

    const amaka = xToken("x2", "amaka");
    await post("/auth/session", { token: amaka, createAccount: true });
    assert.equal((await post(`/requests/${asked.id}/cancel`, {}, amaka)).statusCode, 404);
    assert.equal((await post(`/requests/${asked.id}/cancel`, {}, asker)).json().status, "cancelled");
  });

  test("asking yourself for money is refused", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });
    assert.equal((await post("/requests", { from: "chidi", amount: "5" }, token)).statusCode, 400);
  });

  test("paying many sends once per person, with the sender skipped", async () => {
    adapterStub.heldForClaim = false;
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    // Duplicates and the sender's own handle are both in the list on purpose.
    const sent = await post(
      "/payments/batch",
      { to: ["@amaka", "amaka", "@ada", "chidi"], amount: "1" },
      token,
    );
    assert.equal(sent.statusCode, 200);
    assert.deepEqual(adapterStub.sent, [
      { to: "amaka", amount: "1" },
      { to: "ada", amount: "1" },
    ]);
    assert.equal(sent.json().message, "Sent to 2 people.");
  });

  test("paying many refuses before it starts when the total is too big", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    // The stub holds 12.5 USDC; twenty people at 1 each does not fit.
    const names = Array.from({ length: 20 }, (_, index) => `person${index}`);
    const refused = await post("/payments/batch", { to: names, amount: "1" }, token);
    assert.equal(refused.statusCode, 409);
    // Nothing moved. Running out halfway down a list is unexplainable afterwards.
    assert.deepEqual(adapterStub.sent, []);
  });

  test("linking a free identity attaches it to the same wallet", async () => {
    const googleTokenValue = googleToken("g1");
    const created = await post("/auth/session", {
      token: googleTokenValue,
      createAccount: true,
    });
    const address = created.json().user.address;

    const response = await post("/auth/link", { token: xToken("x1", "amaka") }, googleTokenValue);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().user.address, address);
    assert.deepEqual(response.json().user.handles, [{ platform: "x", username: "amaka" }]);
  });
});
