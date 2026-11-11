import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { StellarAdapter } from "@selkie/chain-stellar";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { FakeIdentityProvider } from "./identity/provider";
import { InMemoryUserStore } from "./identity/store";

/** Minimal chain stand-in: the routes are what is under test here. */
/**
 * A real, checksum-valid Stellar address for the test user, because the send
 * route decides "handle or address" with the same validity rule the network
 * uses. A placeholder like "G_TEST" would never be recognised as an address and
 * the self-send guard could never be exercised.
 */
const MINE = "GDO6DYLR7JRONICHOIXMJZJ4EZLRL3IZDVRFDCF7H2IXMNDKHUZNV2VB";
const THEIRS = "GD2KZSZZRT3TNERHRO7CE7VIOC6VQYKP2XNQENP6DECXSCOUFQ7EO2XS";

const adapterStub = {
  sent: [] as { to: string; amount: string; platform?: string }[],
  heldForClaim: true,
  async ensureAccount(handle: { platform: string; username: string }) {
    return { chain: "stellar", handle, address: MINE, status: "provisioning" };
  },
  /** What the escrow is holding for the next handle that signs in. */
  waiting: [] as bigint[],
  waitingAmounts: [] as { amount: string; asset: string }[],
  async pendingClaims() {
    return adapterStub.waiting;
  },
  async waitingFor() {
    return adapterStub.waitingAmounts;
  },
  provisioned: [] as string[],
  /** Set when the ledger is refusing, so a test can prove sign-up survives it. */
  provisioningFails: false,
  async isReceivable(address: string) {
    return adapterStub.provisioned.includes(address);
  },
  async ensureReceivable(address: string) {
    if (adapterStub.provisioningFails) throw new Error("horizon is having a day");
    adapterStub.provisioned.push(address);
    return { address, accepts: ["USDC", "XLM"] };
  },
  async claim() {
    return { status: "confirmed", ref: "TX" };
  },
  async getBalance(account: unknown) {
    return { account, balances: [{ amount: "12.5", asset: "USDC" }] };
  },
  async send(
    _from: unknown,
    to: { username: string; platform: string },
    amount: { amount: string },
  ) {
    adapterStub.sent.push({ to: to.username, amount: amount.amount, platform: to.platform });
    return {
      status: "confirmed",
      ref: "TX_SEND",
      heldForClaim: adapterStub.heldForClaim,
      // The escrow's own id, which is what a refund needs.
      claimRef: adapterStub.heldForClaim ? String(++adapterStub.escrowId) : undefined,
    };
  },
  transfers: [] as { to: string; amount: string; asset: string }[],
  async transfer(params: { toAddress: string; amount: { amount: string; asset: string } }) {
    adapterStub.transfers.push({
      to: params.toAddress,
      amount: params.amount.amount,
      asset: params.amount.asset,
    });
    return { status: "confirmed", ref: "TX_SWEEP" };
  },
  /** Flipped by the tests that care what happens when an address cannot be paid. */
  receivable: { ok: true } as
    | { ok: true }
    | { ok: false; reason: "no-account" | "no-trustline" },
  async canReceive() {
    return adapterStub.receivable;
  },
  escrowId: 0,
  /** Zero so a test can take money back immediately; production waits 30 days. */
  claimLifetimeSeconds: 0,
  refunded: [] as string[],
  async refund(paymentId: bigint) {
    adapterStub.refunded.push(paymentId.toString());
    return { status: "confirmed", ref: "TX_REFUND" };
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
const telegramToken = (subject: string, username: string) =>
  `test:telegram:${subject}:${username}`;

describe("api", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    adapterStub.sent = [];
    adapterStub.heldForClaim = true;
    adapterStub.provisioned = [];
    adapterStub.provisioningFails = false;
    adapterStub.refunded = [];
    adapterStub.escrowId = 0;
    adapterStub.claimLifetimeSeconds = 0;
    adapterStub.waiting = [];
    adapterStub.waitingAmounts = [];
    adapterStub.transfers = [];
    adapterStub.receivable = { ok: true };
    swapStub.swapped = [];
    app = await buildApp({
      users: new InMemoryUserStore(),
      provider: new FakeIdentityProvider(true),
      adapter: adapterStub as unknown as StellarAdapter,
      swap: swapStub,
      // Hundreds of calls from one address in a few seconds. The limiter gets
      // its own test rather than throttling every other one.
      limits: false,
    });
  });

  const post = async (
    url: string,
    payload: Record<string, unknown>,
    token?: string,
    idempotencyKey?: string,
  ) =>
    await app.inject({
      method: "POST",
      url,
      payload,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
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
    assert.deepEqual(adapterStub.sent, [{ to: "amaka", amount: "5", platform: "x" }]);
  });

  test("one key, two different payments: the second is refused, not answered", async () => {
    // The failure that lost two real payments. The bot was reusing one key for
    // every payment between the same two people, so the first went through and
    // every one after it came back with the first one's receipt. Selkie said
    // "Sent!" and moved nothing. A key that stands for one payment must never
    // answer for another, so this is an error rather than a cache hit.
    adapterStub.heldForClaim = false;
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const first = await post("/payments/send", { to: "amaka", amount: "5" }, token, "same-key");
    assert.equal(first.statusCode, 200);

    const second = await post("/payments/send", { to: "amaka", amount: "9" }, token, "same-key");
    assert.equal(second.statusCode, 422, "a different payment came back as a success");
    assert.match(second.json().error, /Nothing moved/);
    assert.equal(adapterStub.sent.length, 1, "and no second payment was attempted");
  });

  test("one key, the same payment twice: paid once, answered twice", async () => {
    // The case the key is FOR. A phone that loses signal mid-request retries,
    // and the retry must not send the money again.
    adapterStub.heldForClaim = false;
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const first = await post("/payments/send", { to: "amaka", amount: "5" }, token, "same-key");
    const again = await post("/payments/send", { to: "amaka", amount: "5" }, token, "same-key");

    assert.equal(again.statusCode, 200);
    assert.deepEqual(again.json(), first.json(), "the retry should get the original answer");
    assert.equal(adapterStub.sent.length, 1, "and the money should have moved once");
  });

  test("the same payment written in a different field order is still the same payment", async () => {
    adapterStub.heldForClaim = false;
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    await post("/payments/send", { to: "amaka", amount: "5" }, token, "same-key");
    const reordered = await post("/payments/send", { amount: "5", to: "amaka" }, token, "same-key");

    assert.equal(reordered.statusCode, 200, "field order is not part of what was asked for");
    assert.equal(adapterStub.sent.length, 1);
  });

  test("sending to an existing user just says sent", async () => {
    adapterStub.heldForClaim = false;
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const response = await post("/payments/send", { to: "amaka", amount: "5" }, token);
    assert.equal(response.json().message, "Sent to @amaka.");
    assert.equal(response.json().waitingToBeClaimed, false);
  });

  test("converting sets the wallet up to hold what it is converting into", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });
    adapterStub.provisioned = [];

    const response = await post("/payments/convert", { from: "XLM", to: "USDC", amount: "10" }, token);

    assert.equal(response.statusCode, 200);
    // Without this the network rejects the whole conversion with no_trust,
    // because a conversion is a payment to yourself in a different asset.
    assert.deepEqual(adapterStub.provisioned, [MINE]);
    assert.deepEqual(swapStub.swapped, [{ amount: "10", asset: "XLM", to: "USDC" }]);
  });

  test("sending to an address pays it directly, with no escrow", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const response = await post("/payments/send", { to: THEIRS, amount: "5" }, token);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().waitingToBeClaimed, false);
    assert.deepEqual(adapterStub.transfers, [{ to: THEIRS, amount: "5", asset: "USDC" }]);
    // Nothing went through the handle path, so nothing is held for a claim.
    assert.deepEqual(adapterStub.sent, []);
  });

  test("an address is recognised however it is typed", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const response = await post("/payments/send", { to: `  ${THEIRS.toLowerCase()}  ` }, token);
    // Missing amount, not "who is that": it was still read as an address.
    assert.equal(response.statusCode, 400);

    const sent = await post("/payments/send", { to: ` ${THEIRS.toLowerCase()} `, amount: "2" }, token);
    assert.equal(sent.statusCode, 200);
    assert.equal(adapterStub.transfers[0]!.to, THEIRS);
  });

  test("refuses to send to your own address", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const response = await post("/payments/send", { to: MINE, amount: "5" }, token);
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /your own address/);
    assert.deepEqual(adapterStub.transfers, []);
  });

  test("refuses an address that cannot receive, before the money moves", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    adapterStub.receivable = { ok: false, reason: "no-account" };
    const dead = await post("/payments/send", { to: THEIRS, amount: "5" }, token);
    assert.equal(dead.statusCode, 409);
    assert.match(dead.json().error, /not set up yet/);

    adapterStub.receivable = { ok: false, reason: "no-trustline" };
    const unsupported = await post("/payments/send", { to: THEIRS, amount: "5" }, token);
    assert.equal(unsupported.statusCode, 409);
    assert.match(unsupported.json().error, /cannot accept USDC/);

    // The whole point of checking first: nothing left the account either time.
    assert.deepEqual(adapterStub.transfers, []);
  });

  test("a mistyped address is refused rather than paid to a handle", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    // One character changed, so the checksum fails. Falling through to the
    // handle path would pay whoever registered that name; there is no reading
    // of a 56-character string starting with G where that is what was meant.
    const typo = `${THEIRS.slice(0, -1)}A`;
    const response = await post("/payments/send", { to: typo, amount: "5" }, token);

    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /not valid/);
    assert.deepEqual(adapterStub.transfers, []);
    assert.deepEqual(adapterStub.sent, []);
  });

  test("paying an address twice with one key only pays once", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const key = "intent-address-1";
    await post("/payments/send", { to: THEIRS, amount: "5" }, token, key);
    await post("/payments/send", { to: THEIRS, amount: "5" }, token, key);

    assert.deepEqual(adapterStub.transfers, [{ to: THEIRS, amount: "5", asset: "USDC" }]);
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
    assert.equal(response.json().address, MINE);
    assert.deepEqual(response.json().accepts, ["USDC", "XLM"]);
    // The point of the route: an address nobody provisioned cannot be paid.
    assert.ok(adapterStub.provisioned.includes(MINE));
  });

  /**
   * The address Selkie puts on screen.
   *
   * It is not only on the Deposit screen. It sits at the top of every tab with
   * a copy button beside it, and it is in Settings. Somebody copied it into the
   * app they keep their money in and was told "the destination account doesn't
   * exist", because Selkie waited until the Deposit screen to make the wallet
   * real. The rule these tests hold down: if we show an address, it works.
   */
  describe("the address we show people", () => {
    test("can receive money from the moment the account exists", async () => {
      const response = await post("/auth/session", {
        token: xToken("x1", "amaka"),
        createAccount: true,
      });

      assert.equal(response.statusCode, 200);
      assert.ok(
        adapterStub.provisioned.includes(response.json().user.address),
        "we handed out an address that cannot be paid",
      );
    });

    test("is repaired for accounts made before Selkie did that", async () => {
      const token = xToken("x1", "amaka");
      await post("/auth/session", { token, createAccount: true });
      // An account from before this existed: real to Selkie, absent from the ledger.
      adapterStub.provisioned = [];

      const me = await app.inject({
        method: "GET",
        url: "/me",
        headers: { authorization: `Bearer ${token}` },
      });

      assert.equal(me.statusCode, 200);
      assert.deepEqual(adapterStub.provisioned, [MINE], "an old wallet stays unusable");
    });

    test("is not set up again on every page load", async () => {
      // This runs on a route the app calls constantly. Doing ledger work each
      // time would put a network round trip in front of every screen.
      const token = xToken("x1", "amaka");
      await post("/auth/session", { token, createAccount: true });
      const afterSignUp = adapterStub.provisioned.length;

      for (let n = 0; n < 3; n++) {
        await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
      }

      assert.equal(adapterStub.provisioned.length, afterSignUp);
    });

    test("a ledger having a bad day does not cost somebody their sign-up", async () => {
      // Losing the account would be far worse than a wallet that is not ready
      // yet, and the next page load tries again.
      adapterStub.provisioningFails = true;

      const response = await post("/auth/session", {
        token: xToken("x1", "amaka"),
        createAccount: true,
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.json().status, "created");
    });

    test("and the wallet is made real on the next page load instead", async () => {
      const token = xToken("x1", "amaka");
      adapterStub.provisioningFails = true;
      await post("/auth/session", { token, createAccount: true });

      adapterStub.provisioningFails = false;
      await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });

      assert.deepEqual(adapterStub.provisioned, [MINE]);
    });
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
    assert.deepEqual(adapterStub.sent, [{ to: "chidi", amount: "20", platform: "x" }]);
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
      { to: "amaka", amount: "1", platform: "x" },
      { to: "ada", amount: "1", platform: "x" },
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

  /**
   * "Anyone's money can wait, but nobody's money can be stuck." Money sent to a
   * handle that never joins has to have a way home.
   */
  test("money that was never claimed can be taken back", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });
    await post("/payments/send", { to: "@amaka", amount: "5" }, token);

    const before = await app.inject({
      method: "GET",
      url: "/activity",
      headers: { authorization: `Bearer ${token}` },
    });
    const entry = before.json().entries[0];
    assert.equal(entry.status, "pending");
    assert.ok(entry.claimRef, "waiting money must carry the id needed to get it back");

    const returned = await post(`/payments/${entry.claimRef}/refund`, {}, token);
    assert.equal(returned.statusCode, 200);
    assert.deepEqual(adapterStub.refunded, [entry.claimRef]);

    const after = await app.inject({
      method: "GET",
      url: "/activity",
      headers: { authorization: `Bearer ${token}` },
    });
    // One payment, one line. Not a second entry that double-counts the money.
    assert.equal(after.json().entries.length, 1);
    assert.equal(after.json().entries[0].status, "returned");
  });

  test("money still inside its waiting period stays put", async () => {
    adapterStub.claimLifetimeSeconds = 60 * 60;
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });
    await post("/payments/send", { to: "@amaka", amount: "5" }, token);

    const feed = await app.inject({
      method: "GET",
      url: "/activity",
      headers: { authorization: `Bearer ${token}` },
    });
    const { claimRef } = feed.json().entries[0];

    const refused = await post(`/payments/${claimRef}/refund`, {}, token);
    assert.equal(refused.statusCode, 409);
    assert.deepEqual(adapterStub.refunded, [], "nothing may move before the wait is over");
  });

  test("only the sender can take a payment back", async () => {
    const sender = xToken("x1", "chidi");
    await post("/auth/session", { token: sender, createAccount: true });
    await post("/payments/send", { to: "@amaka", amount: "5" }, sender);

    const feed = await app.inject({
      method: "GET",
      url: "/activity",
      headers: { authorization: `Bearer ${sender}` },
    });
    const { claimRef } = feed.json().entries[0];

    // A stranger who knows the id gets the same answer as for one that does not
    // exist, so an id never confirms a payment is real.
    const stranger = xToken("x9", "stranger");
    await post("/auth/session", { token: stranger, createAccount: true });
    const refused = await post(`/payments/${claimRef}/refund`, {}, stranger);
    assert.equal(refused.statusCode, 404);
    assert.deepEqual(adapterStub.refunded, []);
  });

  test("a payment cannot be taken back twice", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });
    await post("/payments/send", { to: "@amaka", amount: "5" }, token);

    const feed = await app.inject({
      method: "GET",
      url: "/activity",
      headers: { authorization: `Bearer ${token}` },
    });
    const { claimRef } = feed.json().entries[0];

    await post(`/payments/${claimRef}/refund`, {}, token);
    const again = await post(`/payments/${claimRef}/refund`, {}, token);
    assert.equal(again.statusCode, 409);
    assert.equal(adapterStub.refunded.length, 1, "the second attempt must not move money");
  });

  test("a payment that landed has nothing to take back", async () => {
    adapterStub.heldForClaim = false;
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });
    await post("/payments/send", { to: "@amaka", amount: "5" }, token);

    const feed = await app.inject({
      method: "GET",
      url: "/activity",
      headers: { authorization: `Bearer ${token}` },
    });
    const entry = feed.json().entries[0];
    assert.equal(entry.status, "confirmed");
    assert.equal(entry.claimRef, undefined, "settled money is not refundable");
  });

  test("taking money back needs a bearer token", async () => {
    assert.equal((await post("/payments/1/refund", {})).statusCode, 401);
  });

  /**
   * The double-tap. A phone that loses signal mid-request, a retry, an
   * impatient thumb: all of them arrive as a second identical request, and
   * sending the money twice is not a recoverable mistake.
   */
  test("the same payment sent twice with one key only moves money once", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const first = await post("/payments/send", { to: "@amaka", amount: "5" }, token, "key-1");
    const second = await post("/payments/send", { to: "@amaka", amount: "5" }, token, "key-1");

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    // The retry gets the first answer back, word for word.
    assert.deepEqual(second.json(), first.json());
    assert.equal(adapterStub.sent.length, 1, "the retry must not send again");
  });

  test("paying the same person twice on purpose still works", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    await post("/payments/send", { to: "@amaka", amount: "5" }, token, "key-1");
    await post("/payments/send", { to: "@amaka", amount: "5" }, token, "key-2");
    assert.equal(adapterStub.sent.length, 2);
  });

  test("one person's key cannot replay into another person's payment", async () => {
    const chidi = xToken("x1", "chidi");
    await post("/auth/session", { token: chidi, createAccount: true });
    await post("/payments/send", { to: "@amaka", amount: "5" }, chidi, "shared-key");

    const ada = xToken("x2", "ada");
    await post("/auth/session", { token: ada, createAccount: true });
    await post("/payments/send", { to: "@amaka", amount: "9" }, ada, "shared-key");

    assert.deepEqual(adapterStub.sent, [
      { to: "amaka", amount: "5", platform: "x" },
      { to: "amaka", amount: "9", platform: "x" },
    ]);
  });

  test("a batch sent twice with one key pays the list once", async () => {
    adapterStub.heldForClaim = false;
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    await post("/payments/batch", { to: ["@amaka", "@ada"], amount: "1" }, token, "batch-1");
    await post("/payments/batch", { to: ["@amaka", "@ada"], amount: "1" }, token, "batch-1");
    assert.equal(adapterStub.sent.length, 2, "four payments would be two people paid twice");
  });

  /**
   * `/handles/:username` is the enumeration oracle: cheap for us, and a way to
   * ask who uses Selkie one name at a time. Everything else here is capped
   * because sponsored fees are real money.
   */
  test("hammering a route gets you turned away, politely", async () => {
    const limited = await buildApp({
      users: new InMemoryUserStore(),
      provider: new FakeIdentityProvider(true),
      adapter: adapterStub as unknown as StellarAdapter,
      swap: swapStub,
      limits: { handles: 2 },
    });

    const token = xToken("x1", "chidi");
    await limited.inject({
      method: "POST",
      url: "/auth/session",
      payload: { token, createAccount: true },
    });

    const look = () =>
      limited.inject({
        method: "GET",
        url: "/handles/amaka",
        headers: { authorization: `Bearer ${token}` },
      });

    assert.equal((await look()).statusCode, 200);
    assert.equal((await look()).statusCode, 200);

    const third = await look();
    assert.equal(third.statusCode, 429);
    // A person could read this. It is not a stack trace or a header dump.
    assert.equal(third.json().error, "Too many tries. Wait a minute and try again.");
  });

  test("without a key nothing is deduplicated, because nothing said it should be", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    await post("/payments/send", { to: "@amaka", amount: "5" }, token);
    await post("/payments/send", { to: "@amaka", amount: "5" }, token);
    assert.equal(adapterStub.sent.length, 2);
  });

  /**
   * The sender's half of the claim. Their feed said "Waiting" from the moment
   * they sent it; the day it lands is the day that has to stop being true.
   */
  test("a claim settles the sender's side too, not just the recipient's", async () => {
    const sender = xToken("x1", "chidi");
    await post("/auth/session", { token: sender, createAccount: true });
    await post("/payments/send", { to: "@amaka", amount: "5" }, sender);

    const before = await app.inject({
      method: "GET",
      url: "/activity",
      headers: { authorization: `Bearer ${sender}` },
    });
    const { claimRef } = before.json().entries[0];
    assert.equal(before.json().entries[0].status, "pending");

    // @amaka signs in for the first time, and the escrow releases that payment.
    adapterStub.waiting = [BigInt(claimRef)];
    adapterStub.waitingAmounts = [{ amount: "5", asset: "USDC" }];
    await post("/auth/session", { token: xToken("x2", "amaka"), createAccount: true });

    const after = await app.inject({
      method: "GET",
      url: "/activity",
      headers: { authorization: `Bearer ${sender}` },
    });
    assert.equal(after.json().entries[0].status, "confirmed");
  });

  test("a payment already taken back is never re-marked as delivered", async () => {
    const sender = xToken("x1", "chidi");
    await post("/auth/session", { token: sender, createAccount: true });
    await post("/payments/send", { to: "@amaka", amount: "5" }, sender);

    const feed = await app.inject({
      method: "GET",
      url: "/activity",
      headers: { authorization: `Bearer ${sender}` },
    });
    const { claimRef } = feed.json().entries[0];
    await post(`/payments/${claimRef}/refund`, {}, sender);

    // A stale claim naming the same id must not undo the return.
    adapterStub.waiting = [BigInt(claimRef)];
    adapterStub.waitingAmounts = [{ amount: "5", asset: "USDC" }];
    await post("/auth/session", { token: xToken("x2", "amaka"), createAccount: true });

    const after = await app.inject({
      method: "GET",
      url: "/activity",
      headers: { authorization: `Bearer ${sender}` },
    });
    assert.equal(after.json().entries[0].status, "returned");
  });

  test("telegram is a door and an address, same as X", async () => {
    const response = await post("/auth/session", {
      token: telegramToken("t1", "amaka"),
      createAccount: true,
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().user.handles, [{ platform: "telegram", username: "amaka" }]);
  });

  test("sending to a telegram handle goes to telegram, not X", async () => {
    const token = telegramToken("t1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const response = await post(
      "/payments/send",
      { to: "@amaka", platform: "telegram", amount: "5" },
      token,
    );
    assert.equal(response.statusCode, 200);
    assert.deepEqual(adapterStub.sent, [{ to: "amaka", amount: "5", platform: "telegram" }]);
  });

  /**
   * The property the whole platform field exists to protect. These are two
   * different people who happen to have picked the same name, and paying one
   * must never reach the other.
   */
  test("@amaka on X and @amaka on telegram are different people", async () => {
    await post("/auth/session", { token: xToken("x2", "amaka"), createAccount: true });

    const token = telegramToken("t1", "chidi");
    await post("/auth/session", { token, createAccount: true });

    const onX = await app.inject({
      method: "GET",
      url: "/handles/amaka?platform=x",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(onX.json().onSelkie, true);

    // Same name, other platform: nobody has claimed it, so it is still a valid
    // destination but a different one.
    const onTelegram = await app.inject({
      method: "GET",
      url: "/handles/amaka?platform=telegram",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(onTelegram.json().onSelkie, false);
    assert.deepEqual(onTelegram.json().handle, { platform: "telegram", username: "amaka" });
  });

  test("a request to a telegram handle reaches its telegram owner", async () => {
    const asker = xToken("x1", "chidi");
    await post("/auth/session", { token: asker, createAccount: true });
    await post("/requests", { from: "@amaka", platform: "telegram", amount: "20" }, asker);

    // The X @amaka is a different person and must not see it.
    const onX = xToken("x2", "amaka");
    await post("/auth/session", { token: onX, createAccount: true });
    const wrong = await app.inject({
      method: "GET",
      url: "/requests",
      headers: { authorization: `Bearer ${onX}` },
    });
    assert.deepEqual(wrong.json().incoming, []);

    const onTelegram = telegramToken("t2", "amaka");
    await post("/auth/session", { token: onTelegram, createAccount: true });
    const right = await app.inject({
      method: "GET",
      url: "/requests",
      headers: { authorization: `Bearer ${onTelegram}` },
    });
    assert.equal(right.json().incoming.length, 1);
  });

  test("activity records the platform, so history can be paid again", async () => {
    const token = xToken("x1", "chidi");
    await post("/auth/session", { token, createAccount: true });
    await post("/payments/send", { to: "@amaka", platform: "telegram", amount: "5" }, token);

    const feed = await app.inject({
      method: "GET",
      url: "/activity",
      headers: { authorization: `Bearer ${token}` },
    });
    // "@amaka" alone would send the repeat payment to the wrong person.
    assert.deepEqual(feed.json().entries[0].counterpartyHandle, {
      platform: "telegram",
      username: "amaka",
    });
  });

  test("linking telegram to an X account keeps one wallet and two handles", async () => {
    const x = xToken("x1", "chidi");
    const created = await post("/auth/session", { token: x, createAccount: true });
    const address = created.json().user.address;

    const response = await post("/auth/link", { token: telegramToken("t1", "chidi_tg") }, x);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().user.address, address);
    assert.deepEqual(response.json().user.handles, [
      { platform: "x", username: "chidi" },
      { platform: "telegram", username: "chidi_tg" },
    ]);
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
