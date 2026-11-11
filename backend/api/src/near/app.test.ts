/**
 * The NEAR app, end to end, against a simulated chain.
 *
 * Everything but the chain is real: sign-in, account opening, prepare, the
 * user's key signing the delegate hash, the relay's byte-for-byte check, and
 * the feed. Each user's "Privy wallet" is a real ed25519 key made here, so a
 * signature that does not match what was prepared fails exactly as it would.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import type { NearChain } from "@selkie/chain-near";
import { signPrepared } from "@selkie/chain-near/browser";
import type { FastifyInstance } from "fastify";
import { InMemoryActivityStore } from "../activity/store";
import { FakeIdentityProvider } from "../identity/provider";
import { InMemoryUserStore } from "../identity/store";
import { InMemoryRequestStore } from "../requests/store";
import { buildNearApp } from "./app";
import { OUTSIDE } from "./balance-watch";
import { PushNotifier } from "../push/notifier";
import { InMemoryPushStore } from "../push/store";
import { SimulatedNearChain } from "./simulated-chain";
import { InMemoryNearAccountStore, InMemoryPrepareStore } from "./store";

const DOLLAR = 1_000_000n;

/** One ed25519 key per X user id: their embedded wallet, made on first use. */
const wallets = new Map<string, { publicHex: string; secret: KeyObject }>();
function walletOf(subject: string) {
  let wallet = wallets.get(subject);
  if (!wallet) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const raw = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
    wallet = { publicHex: raw.toString("hex"), secret: privateKey };
    wallets.set(subject, wallet);
  }
  return wallet;
}

/** The fake provider, plus the one thing NEAR needs from Privy: the user's wallet address. */
class WalletProvider extends FakeIdentityProvider {
  constructor() {
    super(true);
  }
  async walletAddress(token: string): Promise<string | null> {
    return walletOf(token.split(":")[2]!).publicHex;
  }
}

interface Person {
  subject: string;
  username: string;
  token: string;
  account?: string;
}
const person = (subject: string, username: string): Person => ({
  subject,
  username,
  token: `test:x:${subject}:${username}`,
});

let app: FastifyInstance;
let chain: SimulatedNearChain;
let requests: InMemoryRequestStore;
let accounts: InMemoryNearAccountStore;
let notifier: PushNotifier;
/** What reached each browser's push service: endpoint -> notification bodies. */
let pushed: Map<string, string[]>;
/** The balance watch's clock, moved by hand. */
let clock = 0;
const SETTLE_MS = 10_000;

beforeEach(async () => {
  chain = new SimulatedNearChain();
  requests = new InMemoryRequestStore();
  accounts = new InMemoryNearAccountStore();
  clock = 0;
  pushed = new Map();
  const pushStore = new InMemoryPushStore();
  notifier = new PushNotifier({
    store: pushStore,
    send: async (target, payload) => {
      pushed.set(target.endpoint, [...(pushed.get(target.endpoint) ?? []), JSON.parse(payload).body]);
    },
  });
  app = await buildNearApp({
    push: { store: pushStore, notifier, publicKey: "BPublicKeyForTests" },
    users: new InMemoryUserStore(),
    provider: new WalletProvider(),
    chain: chain as unknown as NearChain,
    accounts,
    watch: { settleAfterMs: SETTLE_MS, now: () => clock },
    prepares: new InMemoryPrepareStore(),
    activity: new InMemoryActivityStore(),
    requests,
    limits: false,
  });
});

const auth = (who: Person) => ({ authorization: `Bearer ${who.token}` });

async function signIn(who: Person) {
  const res = await app.inject({ method: "POST", url: "/auth/session", payload: { token: who.token, createAccount: true } });
  assert.equal(res.statusCode, 200, res.body);
  who.account = res.json().user.address;
  return res.json();
}

async function prepare(who: Person, body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/near/payments/prepare", headers: auth(who), payload: body });
}

/** What the browser does: sign the prepared delegate's hash with the user's own key. */
async function signFor(who: Person, delegate: Parameters<typeof signPrepared>[0]) {
  const { secret } = walletOf(who.subject);
  return signPrepared(delegate, async (hash) => new Uint8Array(sign(null, hash, secret)));
}

/** prepare -> sign -> relay, as the web app does it. */
async function pay(who: Person, body: Record<string, unknown>) {
  const prepared = await prepare(who, body);
  if (prepared.statusCode !== 200) return prepared;
  const { prepareId, delegate } = prepared.json();
  const signedDelegate = await signFor(who, delegate);
  return app.inject({ method: "POST", url: "/near/relay", headers: auth(who), payload: { prepareId, signedDelegate } });
}

async function feed(who: Person) {
  const res = await app.inject({ method: "GET", url: "/activity", headers: auth(who) });
  return res.json().entries as { kind: string; status: string; counterparty?: string; claimRef?: string; amount: { amount: string } }[];
}

/** What the wallet's 12-second poll does: read the balance. */
async function look(who: Person) {
  const res = await app.inject({ method: "GET", url: "/me", headers: auth(who) });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().balances[0].amount as string;
}

/** Look, wait out the settle time, look again: long enough for any real difference to be written. */
async function settle(who: Person) {
  await look(who);
  clock += SETTLE_MS;
  await look(who);
}

const fromOutside = async (who: Person) => (await feed(who)).filter((entry) => entry.counterparty === OUTSIDE);

describe("NEAR app", () => {
  test("signing in opens an account whose only key is the user's", async () => {
    const amaka = person("1001", "amaka");
    await signIn(amaka);
    assert.equal(amaka.account, "amaka.x.selkie.test");

    const res = await app.inject({ method: "GET", url: "/near/account/keys", headers: auth(amaka) });
    const body = res.json();
    assert.equal(body.keys.length, 1);
    assert.equal(body.keys[0].heldBy, "you");
    assert.equal(body.selkieHoldsKey, false);
  });

  test("money sent to a handle that never signed in waits, then lands when they do", async () => {
    const tunde = person("2001", "tunde");
    const amaka = person("1001", "amaka");
    await signIn(tunde);
    chain.fund(tunde.account!, 5n * DOLLAR);

    const sent = await pay(tunde, { to: "@amaka", amount: "2" });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.equal(sent.json().waitingToBeClaimed, true);
    assert.equal((await feed(tunde))[0]!.status, "pending");

    const session = await signIn(amaka);
    assert.equal(session.claimed.length, 1);
    assert.equal(await chain.usdcBalance(amaka.account!), 2n * DOLLAR);
    assert.equal((await feed(tunde))[0]!.status, "confirmed");
    assert.equal((await feed(amaka))[0]!.kind, "claim");
  });

  test("money sent to a Selkie user goes straight into their account", async () => {
    const tunde = person("2001", "tunde");
    const amaka = person("1001", "amaka");
    await signIn(tunde);
    await signIn(amaka);
    chain.fund(tunde.account!, 5n * DOLLAR);

    const sent = await pay(tunde, { to: "amaka", amount: "1.5" });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.equal(sent.json().status, "confirmed");
    assert.equal(await chain.usdcBalance(amaka.account!), 1_500_000n);
    assert.equal((await feed(amaka))[0]!.kind, "receive");
  });

  test("a prepared payment can be relayed once", async () => {
    const tunde = person("2001", "tunde");
    await signIn(tunde);
    chain.fund(tunde.account!, 5n * DOLLAR);
    const prepared = (await prepare(tunde, { to: "amaka", amount: "1" })).json();
    const signedDelegate = await signFor(tunde, prepared.delegate);
    const relay = () =>
      app.inject({
        method: "POST",
        url: "/near/relay",
        headers: auth(tunde),
        payload: { prepareId: prepared.prepareId, signedDelegate },
      });
    assert.equal((await relay()).statusCode, 200);
    assert.equal((await relay()).statusCode, 410);
    assert.equal(await chain.usdcBalance(tunde.account!), 4n * DOLLAR);
  });

  test("a signature from another key is refused and nothing moves", async () => {
    const tunde = person("2001", "tunde");
    await signIn(tunde);
    chain.fund(tunde.account!, 5n * DOLLAR);
    const prepared = (await prepare(tunde, { to: "amaka", amount: "1" })).json();
    const forged = await signFor(person("9999", "mallory"), prepared.delegate);
    const res = await app.inject({
      method: "POST",
      url: "/near/relay",
      headers: auth(tunde),
      payload: { prepareId: prepared.prepareId, signedDelegate: forged },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(chain.relayed.length, 0);
  });

  describe("pay a NEAR account", () => {
    test("any existing account, registered for USDC on the way", async () => {
      const tunde = person("2001", "tunde");
      await signIn(tunde);
      chain.fund(tunde.account!, 5n * DOLLAR);
      chain.addOutsideAccount("friend.testnet");

      const res = await pay(tunde, { toAccount: "Friend.testnet", amount: "1.25" });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(await chain.usdcBalance("friend.testnet"), 1_250_000n);
      const [entry] = await feed(tunde);
      assert.equal(entry!.kind, "send");
      assert.equal(entry!.counterparty, "friend.testnet");
    });

    test("cash out shows as cash out in the feed", async () => {
      const tunde = person("2001", "tunde");
      await signIn(tunde);
      chain.fund(tunde.account!, 5n * DOLLAR);
      chain.addOutsideAccount("deposit.exchange.testnet");

      const res = await pay(tunde, { toAccount: "deposit.exchange.testnet", amount: "3", purpose: "cashout" });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal((await feed(tunde))[0]!.kind, "cashout");
    });

    test("a Selkie user's account shows the payment on their side too", async () => {
      const tunde = person("2001", "tunde");
      const amaka = person("1001", "amaka");
      await signIn(tunde);
      await signIn(amaka);
      chain.fund(tunde.account!, 5n * DOLLAR);

      const res = await pay(tunde, { toAccount: amaka.account, amount: "1" });
      assert.equal(res.statusCode, 200, res.body);
      const [entry] = await feed(amaka);
      assert.equal(entry!.kind, "receive");
      assert.equal(entry!.counterparty, "@tunde");
    });

    test("bad names, missing accounts, contracts and yourself are refused before signing", async () => {
      const tunde = person("2001", "tunde");
      await signIn(tunde);
      chain.fund(tunde.account!, 5n * DOLLAR);

      for (const toAccount of ["not an account", "ghost.testnet", "usdc.test", "escrow.test", tunde.account]) {
        const res = await prepare(tunde, { toAccount, amount: "1" });
        assert.equal(res.statusCode, 400, `${toAccount}: ${res.body}`);
      }
      assert.equal((await prepare(tunde, { toAccount: "x.selkie.test", amount: "99" })).statusCode, 409);
    });
  });

  describe("pay many", () => {
    test("Selkie users are paid now and everyone else waits, in one signature", async () => {
      const tunde = person("2001", "tunde");
      const amaka = person("1001", "amaka");
      const kemi = person("3001", "kemi");
      await signIn(tunde);
      await signIn(amaka);
      chain.fund(tunde.account!, 10n * DOLLAR);

      const res = await pay(tunde, { toMany: ["@amaka", "kemi", "@KEMI", "@tunde", "bayo"], amount: "2" });
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json();
      assert.deepEqual(
        body.results.map((r: { handle: string; waitingToBeClaimed: boolean }) => [r.handle, r.waitingToBeClaimed]),
        [
          ["@amaka", false],
          ["@kemi", true],
          ["@bayo", true],
        ],
      );
      assert.equal(chain.relayed.length, 1, "one signature for everyone");
      assert.equal(await chain.usdcBalance(tunde.account!), 4n * DOLLAR);
      assert.equal(await chain.usdcBalance(amaka.account!), 2n * DOLLAR);
      assert.equal(chain.payments.size, 2);

      await signIn(kemi);
      assert.equal(await chain.usdcBalance(kemi.account!), 2n * DOLLAR);
      const statuses = (await feed(tunde)).map((entry) => `${entry.counterparty}:${entry.status}`);
      assert.ok(statuses.includes("@kemi:confirmed"), statuses.join(", "));
      assert.ok(statuses.includes("@bayo:pending"), statuses.join(", "));
    });

    test("not enough for everyone is refused before signing", async () => {
      const tunde = person("2001", "tunde");
      await signIn(tunde);
      chain.fund(tunde.account!, 3n * DOLLAR);
      const res = await prepare(tunde, { toMany: ["a1", "b2"], amount: "2" });
      assert.equal(res.statusCode, 409);
      assert.match(res.json().error, /\$4/);
    });

    test("more than the cap is refused", async () => {
      const tunde = person("2001", "tunde");
      await signIn(tunde);
      chain.fund(tunde.account!, 100n * DOLLAR);
      const many = Array.from({ length: 21 }, (_, i) => `user${i}`);
      assert.equal((await prepare(tunde, { toMany: many, amount: "1" })).statusCode, 400);
    });
  });

  describe("requests", () => {
    test("ask, see it, pay it once, and both sides agree it was paid", async () => {
      const tunde = person("2001", "tunde");
      const amaka = person("1001", "amaka");
      await signIn(tunde);
      await signIn(amaka);
      chain.fund(amaka.account!, 5n * DOLLAR);

      const asked = await app.inject({
        method: "POST",
        url: "/requests",
        headers: auth(tunde),
        payload: { from: "@amaka", amount: "2.5", note: "lunch" },
      });
      assert.equal(asked.statusCode, 200, asked.body);
      const id = asked.json().request.id;

      const incoming = (await app.inject({ method: "GET", url: "/requests", headers: auth(amaka) })).json().incoming;
      assert.equal(incoming.length, 1);
      assert.equal(incoming[0].amount.amount, "2.5");

      // Someone else cannot pay a request that is not addressed to them.
      assert.equal((await prepare(tunde, { requestId: id })).statusCode, 404);

      const paid = await pay(amaka, { requestId: id });
      assert.equal(paid.statusCode, 200, paid.body);
      assert.equal(await chain.usdcBalance(tunde.account!), 2_500_000n);
      assert.equal((await requests.get(id))?.status, "paid");
      assert.equal((await pay(amaka, { requestId: id })).statusCode, 409);
    });

    test("a request paid from two tabs moves money once", async () => {
      const tunde = person("2001", "tunde");
      const amaka = person("1001", "amaka");
      await signIn(tunde);
      await signIn(amaka);
      chain.fund(amaka.account!, 5n * DOLLAR);
      const id = (
        await app.inject({ method: "POST", url: "/requests", headers: auth(tunde), payload: { from: "amaka", amount: "1" } })
      ).json().request.id;

      const first = (await prepare(amaka, { requestId: id })).json();
      const second = (await prepare(amaka, { requestId: id })).json();
      const relay = async (prepared: { prepareId: string; delegate: Parameters<typeof signPrepared>[0] }) =>
        app.inject({
          method: "POST",
          url: "/near/relay",
          headers: auth(amaka),
          payload: { prepareId: prepared.prepareId, signedDelegate: await signFor(amaka, prepared.delegate) },
        });
      assert.equal((await relay(first)).statusCode, 200);
      assert.equal((await relay(second)).statusCode, 409);
      assert.equal(await chain.usdcBalance(tunde.account!), DOLLAR);
    });

    test("a request to someone not on Selkie yet waits for them; they can decline it", async () => {
      const tunde = person("2001", "tunde");
      const amaka = person("1001", "amaka");
      await signIn(tunde);
      const id = (
        await app.inject({ method: "POST", url: "/requests", headers: auth(tunde), payload: { from: "amaka", amount: "1" } })
      ).json().request.id;

      await signIn(amaka);
      const declined = await app.inject({ method: "POST", url: `/requests/${id}/decline`, headers: auth(amaka) });
      assert.equal(declined.statusCode, 200);
      assert.equal(declined.json().request.status, "declined");
      const cancel = await app.inject({ method: "POST", url: `/requests/${id}/cancel`, headers: auth(tunde) });
      assert.equal(cancel.statusCode, 409);
    });
  });

  test("the sender takes back an unclaimed payment after it expires, not before", async () => {
    const tunde = person("2001", "tunde");
    await signIn(tunde);
    chain.fund(tunde.account!, 5n * DOLLAR);
    const sent = (await pay(tunde, { to: "nobody_yet", amount: "1" })).json();
    assert.ok(sent.claimRef);

    assert.equal((await prepare(tunde, { refundId: sent.claimRef })).statusCode, 409);
    chain.expire(sent.claimRef);
    const back = await pay(tunde, { refundId: sent.claimRef });
    assert.equal(back.statusCode, 200, back.body);
    assert.equal(back.json().status, "returned");
    assert.equal(await chain.usdcBalance(tunde.account!), 5n * DOLLAR);
    assert.equal((await feed(tunde))[0]!.status, "returned");
  });

  describe("money from outside Selkie", () => {
    test("a deposit shows in the feed once it has held, and only once", async () => {
      const amaka = person("1001", "amaka");
      await signIn(amaka);
      chain.fund(amaka.account!, 20n * DOLLAR);

      assert.equal(await look(amaka), "20");
      assert.equal((await fromOutside(amaka)).length, 0, "a difference seen once could be a lagging node");
      clock += SETTLE_MS - 1;
      await look(amaka);
      assert.equal((await fromOutside(amaka)).length, 0);
      clock += 1;
      await look(amaka);

      const [line] = await feed(amaka);
      assert.equal(line!.kind, "receive");
      assert.equal(line!.counterparty, OUTSIDE);
      assert.equal(line!.amount.amount, "20");

      clock += 60_000;
      await look(amaka);
      await look(amaka);
      assert.equal((await feed(amaka)).length, 1);
    });

    test("money Selkie moved itself is never called outside", async () => {
      const tunde = person("2001", "tunde");
      const amaka = person("1001", "amaka");
      await signIn(tunde);
      await signIn(amaka);
      chain.fund(tunde.account!, 10n * DOLLAR);
      await settle(tunde);
      assert.equal((await fromOutside(tunde)).length, 1, "the faucet money");

      assert.equal((await pay(tunde, { to: "@amaka", amount: "1" })).statusCode, 200);
      assert.equal((await pay(tunde, { to: "@bisi", amount: "2" })).statusCode, 200);
      assert.equal((await pay(tunde, { toAccount: amaka.account, amount: "0.5" })).statusCode, 200);
      assert.equal((await pay(tunde, { toMany: ["@amaka", "@kemi"], amount: "1" })).statusCode, 200);
      const bisi = person("3001", "bisi");
      await signIn(bisi);

      for (const who of [tunde, amaka, bisi]) await settle(who);
      clock += SETTLE_MS;
      for (const who of [tunde, amaka, bisi]) await settle(who);

      assert.equal((await fromOutside(tunde)).length, 1);
      assert.equal((await fromOutside(amaka)).length, 0);
      assert.equal((await fromOutside(bisi)).length, 0);
      assert.equal(await look(tunde), "4.5");
    });

    test("a refund is Selkie's own money coming back, not outside money", async () => {
      const tunde = person("2001", "tunde");
      await signIn(tunde);
      chain.fund(tunde.account!, 3n * DOLLAR);
      await settle(tunde);
      const sent = await pay(tunde, { to: "@nobody", amount: "2" });
      const id = sent.json().claimRef as string;
      chain.expire(id);
      assert.equal((await pay(tunde, { refundId: id })).statusCode, 200);

      await settle(tunde);
      assert.equal((await fromOutside(tunde)).length, 1, "only the faucet");
    });

    test("money leaving by another route shows as a send to outside", async () => {
      const amaka = person("1001", "amaka");
      await signIn(amaka);
      chain.fund(amaka.account!, 3n * DOLLAR);
      await settle(amaka);
      // Her key is hers: she can spend from another NEAR wallet app too.
      chain.balances.set(amaka.account!, 1n * DOLLAR);
      await settle(amaka);

      const [line] = await feed(amaka);
      assert.equal(line!.kind, "send");
      assert.equal(line!.counterparty, OUTSIDE);
      assert.equal(line!.amount.amount, "2");
    });

    test("a balance still moving restarts the wait", async () => {
      const amaka = person("1001", "amaka");
      await signIn(amaka);
      chain.fund(amaka.account!, 1n * DOLLAR);
      await look(amaka);
      clock += 6_000;
      chain.fund(amaka.account!, 1n * DOLLAR);
      await look(amaka);
      clock += 6_000;
      await look(amaka);
      assert.equal((await fromOutside(amaka)).length, 0, "the second deposit has only held 6 seconds");
      clock += 4_000;
      await look(amaka);
      assert.deepEqual(
        (await fromOutside(amaka)).map((entry) => entry.amount.amount),
        ["2"],
      );
    });

    test("an account opened before Selkie kept count", async () => {
      const amaka = person("1001", "amaka");
      const tunde = person("2001", "tunde");
      await signIn(amaka);
      await signIn(tunde);
      chain.fund(amaka.account!, 20n * DOLLAR);
      chain.fund(tunde.account!, 5n * DOLLAR);
      assert.equal((await pay(tunde, { to: "@amaka", amount: "1" })).statusCode, 200);
      accounts.forgetSeenUsdc(amaka.account!);
      accounts.forgetSeenUsdc(tunde.account!);
      chain.fund(tunde.account!, 1n * DOLLAR);

      // Amaka has history, so nobody can say which part of her 21 came from
      // outside: counting starts from now. Tunde too.
      await settle(amaka);
      await settle(tunde);
      assert.equal((await fromOutside(amaka)).length, 0);
      assert.equal((await fromOutside(tunde)).length, 0);

      // An empty feed with a balance: all of it came from outside.
      const kemi = person("4001", "kemi");
      await signIn(kemi);
      chain.fund(kemi.account!, 7n * DOLLAR);
      accounts.forgetSeenUsdc(kemi.account!);
      await settle(kemi);
      assert.deepEqual(
        (await fromOutside(kemi)).map((entry) => entry.amount.amount),
        ["7"],
      );
    });
  });

  describe("notifications when money comes in", () => {
    const phone = (who: Person) => `https://fcm.googleapis.com/fcm/send/${who.username}-phone`;
    const subscribe = (who: Person, endpoint = phone(who)) =>
      app.inject({
        method: "POST",
        url: "/push/subscribe",
        headers: auth(who),
        payload: { endpoint, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } },
      });
    const delivered = async (who: Person) => {
      await notifier.settled();
      return pushed.get(phone(who)) ?? [];
    };

    test("a browser subscribes with the server's key, signed in, to a real push service", async () => {
      const amaka = person("1001", "amaka");
      await signIn(amaka);
      assert.deepEqual((await app.inject({ method: "GET", url: "/push/key" })).json(), { publicKey: "BPublicKeyForTests" });
      const anonymous = await app.inject({ method: "POST", url: "/push/subscribe", payload: {} });
      assert.equal(anonymous.statusCode, 401);
      assert.equal((await subscribe(amaka, "https://127.0.0.1/admin")).statusCode, 400);
      assert.equal((await subscribe(amaka)).statusCode, 200);
    });

    test("the person paid gets told who sent what; the payer does not", async () => {
      const tunde = person("2001", "tunde");
      const amaka = person("1001", "amaka");
      await signIn(tunde);
      await signIn(amaka);
      await subscribe(tunde);
      await subscribe(amaka);
      chain.fund(tunde.account!, 5n * DOLLAR);

      assert.equal((await pay(tunde, { to: "@amaka", amount: "1.5" })).statusCode, 200);
      assert.deepEqual(await delivered(amaka), ["@tunde sent you 1.50 USDC."]);
      assert.deepEqual(await delivered(tunde), []);
    });

    test("money from outside Selkie is announced once it is written down", async () => {
      const amaka = person("1001", "amaka");
      await signIn(amaka);
      await subscribe(amaka);
      chain.fund(amaka.account!, 20n * DOLLAR);
      await settle(amaka);
      await look(amaka);
      assert.deepEqual(await delivered(amaka), ["20.00 USDC arrived from outside Selkie."]);
    });

    test("switching off stops them", async () => {
      const tunde = person("2001", "tunde");
      const amaka = person("1001", "amaka");
      await signIn(tunde);
      await signIn(amaka);
      await subscribe(amaka);
      const off = await app.inject({ method: "POST", url: "/push/unsubscribe", headers: auth(amaka), payload: { endpoint: phone(amaka) } });
      assert.equal(off.statusCode, 200);
      chain.fund(tunde.account!, 5n * DOLLAR);
      assert.equal((await pay(tunde, { to: "@amaka", amount: "1" })).statusCode, 200);
      assert.deepEqual(await delivered(amaka), []);
    });
  });
});
