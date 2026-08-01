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

const xToken = (subject: string, username: string) => `test:x:${subject}:${username}`;
const googleToken = (subject: string) => `test:google:${subject}:`;

describe("api", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    adapterStub.sent = [];
    adapterStub.heldForClaim = true;
    app = buildApp({
      users: new InMemoryUserStore(),
      provider: new FakeIdentityProvider(true),
      adapter: adapterStub as unknown as StellarAdapter,
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
