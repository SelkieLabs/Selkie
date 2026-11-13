/**
 * The NEAR app, end to end, against a simulated chain.
 *
 * Everything but the chain is real: sign-in, account opening, prepare, the
 * user's key signing the delegate hash, the relay's byte-for-byte check, and
 * the feed. Each user's "Privy wallet" is a real ed25519 key made here, so a
 * signature that does not match what was prepared fails exactly as it would.
 */
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { MIN_BOT_SECRET_LENGTH } from "@selkie/core";
import {
  IntentsError,
  PREVIEW_ACCOUNT,
  TGAS,
  fromBaseUnits,
  pocketSetCap,
  pocketTopUp,
  pocketWithdraw,
  preparedCall,
  type NearChain,
  type OneClickClient,
  type OneClickQuote,
  type OneClickQuoteRequest,
  type OneClickStatus,
  type OneClickToken,
} from "@selkie/chain-near";
import { signPrepared } from "@selkie/chain-near/browser";
import type { FastifyInstance } from "fastify";
import { InMemoryActivityStore } from "../activity/store";
import { FakeIdentityProvider } from "../identity/provider";
import { InMemoryUserStore } from "../identity/store";
import { InMemoryRequestStore } from "../requests/store";
import { buildNearApp, type NearAppDeps } from "./app";
import { OUTSIDE } from "./balance-watch";
import { EmailService, type OutgoingEmail } from "../email/service";
import { InMemoryEmailStore } from "../email/store";
import { PushNotifier } from "../push/notifier";
import { InMemoryPushStore } from "../push/store";
import { SimulatedNearChain } from "./simulated-chain";
import { InMemoryNearAccountStore, InMemoryPrepareStore } from "./store";
import { PaycrestClient } from "./paycrest";

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
/** What the app was built from, so a describe can rebuild it with one more piece. */
let appDeps: NearAppDeps;
let chain: SimulatedNearChain;
let requests: InMemoryRequestStore;
let accounts: InMemoryNearAccountStore;
let notifier: PushNotifier;
let emails: EmailService;
/** Everything handed to the email provider. */
let mails: OutgoingEmail[];
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
  mails = [];
  emails = new EmailService({
    store: new InMemoryEmailStore(),
    send: async (mail) => void mails.push(mail),
    webUrl: "https://selkie.test",
    linkSecret: "test-secret",
  });
  const pushStore = new InMemoryPushStore();
  notifier = new PushNotifier({
    store: pushStore,
    send: async (target, payload) => {
      pushed.set(target.endpoint, [...(pushed.get(target.endpoint) ?? []), JSON.parse(payload).body]);
    },
  });
  appDeps = {
    push: { store: pushStore, notifier, publicKey: "BPublicKeyForTests" },
    email: emails,
    users: new InMemoryUserStore(),
    provider: new WalletProvider(),
    chain: chain as unknown as NearChain,
    accounts,
    watch: { settleAfterMs: SETTLE_MS, now: () => clock },
    prepares: new InMemoryPrepareStore(),
    activity: new InMemoryActivityStore(),
    requests,
    limits: false,
  };
  app = await buildNearApp(appDeps);
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

    test("a contract is only paid once the sender says they know what it is", async () => {
      const tunde = person("2001", "tunde");
      await signIn(tunde);
      chain.fund(tunde.account!, 5n * DOLLAR);
      chain.addContractAccount("pool.testnet");

      const asked = await prepare(tunde, { toAccount: "pool.testnet", amount: "1.5" });
      assert.equal(asked.statusCode, 409, asked.body);
      assert.equal(asked.json().code, "contract_account");
      assert.equal(asked.json().account, "pool.testnet");
      assert.match(asked.json().error, /smart contract/);
      assert.equal(await chain.usdcBalance("pool.testnet"), 0n);

      const res = await pay(tunde, { toAccount: "pool.testnet", amount: "1.5", toContract: true });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(await chain.usdcBalance("pool.testnet"), 1_500_000n);
    });
  });

  describe("suggest people while a handle is typed", () => {
    const search = (who: Person, q: string) =>
      app.inject({ method: "GET", url: `/handles?q=${encodeURIComponent(q)}`, headers: auth(who) });
    const names = async (who: Person, q: string) =>
      ((await search(who, q)).json().matches as { username: string }[]).map((m) => m.username);

    test("from the third letter, start of the handle first, never yourself", async () => {
      const amanda = person("3001", "big_amanda");
      const amaka = person("1001", "amaka");
      const tunde = person("2001", "tunde");
      for (const who of [amanda, amaka, tunde]) await signIn(who);

      assert.deepEqual(await names(tunde, "am"), [], "two letters is too few");
      assert.deepEqual(await names(tunde, "@AMA"), ["amaka", "big_amanda"]);
      assert.deepEqual(await names(amaka, "ama"), ["big_amanda"]);
      const first = (await search(tunde, "amak")).json().matches[0];
      assert.equal(first.nearAccount, amaka.account);
      assert.deepEqual(await names(tunde, "a%_"), [], "wildcards are not handles");
    });

    test("needs a signed-in caller", async () => {
      const res = await app.inject({ method: "GET", url: "/handles?q=ama" });
      assert.equal(res.statusCode, 401);
    });
  });

  describe("look up a NEAR account before paying it", () => {
    const lookUp = (who: Person, accountId: string) =>
      app.inject({ method: "GET", url: `/near/accounts/${encodeURIComponent(accountId)}`, headers: auth(who) });

    test("says whether it is a wallet, a contract, missing, Selkie, or you", async () => {
      const tunde = person("2001", "tunde");
      const amaka = person("1001", "amaka");
      await signIn(tunde);
      await signIn(amaka);
      chain.addOutsideAccount("friend.testnet");
      chain.addContractAccount("pool.testnet");

      const wallet = (await lookUp(tunde, "Friend.testnet")).json();
      assert.deepEqual(wallet, { accountId: "friend.testnet", kind: "wallet", onSelkie: false, isYou: false });

      const contract = (await lookUp(tunde, "pool.testnet")).json();
      assert.equal(contract.kind, "contract");
      assert.match(contract.warning, /pool\.testnet is a smart contract/);

      assert.equal((await lookUp(tunde, "ghost.testnet")).json().kind, "missing");
      assert.equal((await lookUp(tunde, amaka.account!)).json().onSelkie, true);
      assert.equal((await lookUp(tunde, tunde.account!)).json().isYou, true);
      assert.equal((await lookUp(tunde, "not an account")).statusCode, 400);
    });

    test("needs a signed-in caller", async () => {
      const res = await app.inject({ method: "GET", url: "/near/accounts/friend.testnet" });
      assert.equal(res.statusCode, 401);
    });
  });

  describe("the escrow's smallest payment", () => {
    test("under a cent cannot wait for someone, but can still go to a Selkie user", async () => {
      const tunde = person("2001", "tunde");
      const amaka = person("1001", "amaka");
      await signIn(tunde);
      await signIn(amaka);
      chain.fund(tunde.account!, 5n * DOLLAR);

      const hold = await prepare(tunde, { to: "@newcomer", amount: "0.009" });
      assert.equal(hold.statusCode, 400, hold.body);
      assert.match(hold.json().error, /smallest amount that can wait .* is \$0\.01/);

      const many = await prepare(tunde, { toMany: ["@amaka", "@newcomer"], amount: "0.005" });
      assert.equal(many.statusCode, 400, many.body);

      assert.equal((await pay(tunde, { to: "@amaka", amount: "0.005" })).statusCode, 200);
      assert.equal((await pay(tunde, { toMany: ["@amaka"], amount: "0.005" })).statusCode, 200);
      assert.equal((await pay(tunde, { to: "@newcomer", amount: "0.01" })).statusCode, 200);
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

  describe("email notices", () => {
    const post = (who: Person, url: string, payload: object) => app.inject({ method: "POST", url, headers: auth(who), payload });

    async function provenEmail(who: Person, address: string) {
      const started = await post(who, "/email", { email: address });
      assert.equal(started.statusCode, 200, started.body);
      assert.deepEqual(started.json(), { available: true, email: address, verified: false, pending: true });
      const code = /\b(\d{6})\b/.exec(mails.at(-1)!.text)![1];
      const verified = await post(who, "/email/verify", { code });
      assert.equal(verified.statusCode, 200, verified.body);
      assert.equal(verified.json().verified, true);
    }

    test("prove an address, get paid, get an email; the email's own link stops them", async () => {
      const tunde = person("2001", "tunde");
      const amaka = person("1001", "amaka");
      await signIn(tunde);
      await signIn(amaka);
      const before = await app.inject({ method: "GET", url: "/email", headers: auth(amaka) });
      assert.deepEqual(before.json(), { available: true, email: null, verified: false, pending: false });
      await provenEmail(amaka, "amaka@example.com");

      chain.fund(tunde.account!, 5n * DOLLAR);
      assert.equal((await pay(tunde, { to: "@amaka", amount: "2" })).statusCode, 200);
      await emails.settled();
      const mail = mails.at(-1)!;
      assert.equal(mail.to, "amaka@example.com");
      assert.equal(mail.subject, "@tunde sent you 2.00 USDC");

      // A mail app's one-click unsubscribe: a form POST, no sign-in.
      const oneClick = new URL(mail.headers!["List-Unsubscribe"]!.slice(1, -1));
      const stopped = await app.inject({
        method: "POST",
        url: `/email/unsubscribe${oneClick.search}`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "List-Unsubscribe=One-Click",
      });
      assert.equal(stopped.statusCode, 200, stopped.body);
      assert.equal((await app.inject({ method: "GET", url: "/email", headers: auth(amaka) })).json().email, null);

      assert.equal((await pay(tunde, { to: "@amaka", amount: "1" })).statusCode, 200);
      await emails.settled();
      assert.equal(mails.at(-1), mail, "no more emails");
    });

    test("a wrong code is refused with words, and a forged link stops nothing", async () => {
      const amaka = person("1001", "amaka");
      await signIn(amaka);
      await post(amaka, "/email", { email: "amaka@example.com" });
      const wrong = await post(amaka, "/email/verify", { code: "12345" });
      assert.equal(wrong.statusCode, 400);
      assert.match(wrong.json().error, /not right/);

      const forged = await app.inject({ method: "POST", url: "/email/unsubscribe?u=not-a-uuid&t=x" });
      assert.equal(forged.statusCode, 400);
      assert.equal((await app.inject({ method: "POST", url: "/email/verify" })).statusCode, 401);
    });
  });
});

describe("NEAR Intents: other chains in and out", () => {
  const BASE_USDC = { assetId: "nep141:base-usdc.omft.near", decimals: 6, blockchain: "base", symbol: "USDC" };
  const TRON_USDT = { assetId: "nep141:tron-usdt.omft.near", decimals: 6, blockchain: "tron", symbol: "USDT" };
  /** The USDC the simulated chain holds, as 1Click lists it. */
  const NEAR_USDC = { assetId: "nep141:usdc.test", decimals: 6, blockchain: "near", symbol: "USDC", contractAddress: "usdc.test" };
  const ETH = { assetId: "nep141:eth.omft.near", decimals: 18, blockchain: "eth", symbol: "ETH" };
  const DEPOSIT = "a".repeat(64);
  const BASE_ADDRESS = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

  /** 1Click as the tests need it: every request kept, answers made up from the request. */
  class FakeOneClick {
    quotes: OneClickQuoteRequest[] = [];
    submitted: unknown[] = [];
    /** What the next quote's amountIn says, to test a quote that does not match. */
    amountInOverride: string | null = null;
    async tokens(): Promise<OneClickToken[]> {
      return [ETH, NEAR_USDC, TRON_USDT, BASE_USDC];
    }
    async quote(request: OneClickQuoteRequest): Promise<OneClickQuote> {
      this.quotes.push(request);
      if (request.recipient === "not-an-address") throw new IntentsError("That address doesn't look right for that chain.", 400);
      if (request.amount === "999000000") throw new IntentsError("NEAR Intents could not quote that route just now.", 500);
      const out = (BigInt(request.amount) * 99n) / 100n;
      return {
        amountIn: this.amountInOverride ?? request.amount,
        amountInFormatted: fromBaseUnits(request.amount, 6),
        amountOut: out.toString(),
        amountOutFormatted: fromBaseUnits(out, 6),
        minAmountOut: ((out * 99n) / 100n).toString(),
        timeEstimate: 20,
        depositAddress: request.dry ? undefined : DEPOSIT,
        deadline: request.dry ? null : request.deadline,
      };
    }
    async status(depositAddress: string): Promise<OneClickStatus> {
      return {
        status: "SUCCESS",
        swapDetails: {
          amountInFormatted: "5",
          amountOutFormatted: "4.95",
          destinationChainTxHashes: [{ hash: "0xabc", explorerUrl: `https://basescan.test/tx/${depositAddress.slice(0, 6)}` }],
        },
      };
    }
    async submitDeposit(input: unknown): Promise<void> {
      this.submitted.push(input);
    }
  }

  let oneClick: FakeOneClick;
  const ana = person("9001", "ana");

  async function withIntents(network: "testnet" | "mainnet") {
    (chain.config as { network: string }).network = network;
    oneClick = new FakeOneClick();
    await app.close();
    app = await buildNearApp({ ...appDeps, intents: oneClick as unknown as OneClickClient });
  }

  const quote = (who: Person, body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/near/intents/quote", headers: auth(who), payload: body });

  describe("on testnet", () => {
    beforeEach(() => withIntents("testnet"));

    test("lists stablecoins on other chains and says nothing can move", async () => {
      await signIn(ana);
      const res = await app.inject({ method: "GET", url: "/near/intents/tokens", headers: auth(ana) });
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json();
      assert.equal(body.live, false);
      assert.deepEqual(
        body.assets.map((asset: { chainName: string; symbol: string }) => `${asset.symbol} on ${asset.chainName}`),
        ["USDC on Base", "USDT on Tron"],
      );
    });

    test("a preview prices the move against a stand-in mainnet account, dry", async () => {
      await signIn(ana);
      const res = await quote(ana, { direction: "in", assetId: TRON_USDT.assetId, amount: "120", address: "TXYZrefund" });
      assert.equal(res.statusCode, 200, res.body);
      const view = res.json();
      assert.equal(view.preview, true);
      assert.equal(view.depositAddress, undefined);
      assert.equal(view.amountOutFormatted, "118.8");
      const [sent] = oneClick.quotes;
      assert.equal(sent!.dry, true);
      assert.equal(sent!.recipient, PREVIEW_ACCOUNT, "never the .testnet account: 1Click refuses those");
      assert.equal(sent!.refundTo, "TXYZrefund");
      assert.equal(sent!.originAsset, TRON_USDT.assetId);
      assert.equal(sent!.destinationAsset, NEAR_USDC.assetId);
    });

    test("asking for a deposit address is refused, with words that say why", async () => {
      await signIn(ana);
      const res = await quote(ana, { direction: "in", assetId: BASE_USDC.assetId, amount: "5", address: BASE_ADDRESS, commit: true });
      assert.equal(res.statusCode, 409);
      assert.match(res.json().error, /mainnet/);
      assert.equal(oneClick.quotes.length, 0);
    });

    test("a cash-out to another chain cannot be prepared", async () => {
      await signIn(ana);
      chain.fund(ana.account!, 10n * DOLLAR);
      const res = await prepare(ana, { amount: "5", toChain: { assetId: BASE_USDC.assetId, address: BASE_ADDRESS } });
      assert.equal(res.statusCode, 409);
      assert.equal(oneClick.quotes.length, 0);
    });

    test("1Click's refusals come back as plain words and the right status", async () => {
      await signIn(ana);
      const bad = await quote(ana, { direction: "out", assetId: BASE_USDC.assetId, amount: "5", address: "not-an-address" });
      assert.equal(bad.statusCode, 400);
      assert.match(bad.json().error, /address doesn't look right/);
      const down = await quote(ana, { direction: "out", assetId: BASE_USDC.assetId, amount: "999", address: BASE_ADDRESS });
      assert.equal(down.statusCode, 502);
      const unknown = await quote(ana, { direction: "out", assetId: ETH.assetId, amount: "5", address: BASE_ADDRESS });
      assert.equal(unknown.statusCode, 400, "only the listed stablecoins");
      const noAmount = await quote(ana, { direction: "in", assetId: BASE_USDC.assetId, amount: "", address: BASE_ADDRESS });
      assert.equal(noAmount.statusCode, 400);
    });

    test("status is passed through, with only what the app shows", async () => {
      await signIn(ana);
      const res = await app.inject({ method: "GET", url: `/near/intents/status?depositAddress=${DEPOSIT}`, headers: auth(ana) });
      assert.equal(res.statusCode, 200, res.body);
      assert.deepEqual(res.json(), {
        status: "SUCCESS",
        done: true,
        amountInFormatted: "5",
        amountOutFormatted: "4.95",
        originTxs: [],
        destinationTxs: ["https://basescan.test/tx/aaaaaa"],
      });
      const junk = await app.inject({ method: "GET", url: "/near/intents/status?depositAddress=../x", headers: auth(ana) });
      assert.equal(junk.statusCode, 400);
    });

    test("needs a signed-in person", async () => {
      const res = await app.inject({ method: "GET", url: "/near/intents/tokens" });
      assert.equal(res.statusCode, 401);
    });
  });

  describe("on mainnet", () => {
    beforeEach(() => withIntents("mainnet"));

    test("money in gets a real quote and a deposit address for the person's own account", async () => {
      await signIn(ana);
      const res = await quote(ana, { direction: "in", assetId: BASE_USDC.assetId, amount: "5", address: BASE_ADDRESS, commit: true });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().preview, false);
      assert.equal(res.json().depositAddress, DEPOSIT);
      const [sent] = oneClick.quotes;
      assert.equal(sent!.dry, false);
      assert.equal(sent!.recipient, ana.account);
      assert.equal(sent!.refundTo, BASE_ADDRESS);
    });

    test("a cash-out signs a transfer of exactly the quote to exactly its deposit address", async () => {
      await signIn(ana);
      chain.fund(ana.account!, 10n * DOLLAR);
      const res = await pay(ana, { amount: "5", toChain: { assetId: BASE_USDC.assetId, address: BASE_ADDRESS } });
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json();
      assert.equal(body.status, "confirmed");
      assert.deepEqual(body.intents, { depositAddress: DEPOSIT });
      assert.match(body.message, /On its way: about 4\.95 USDC to 0x5aAeb6…1BeAed on Base/);

      const [sent] = oneClick.quotes;
      assert.equal(sent!.dry, false);
      assert.equal(sent!.originAsset, NEAR_USDC.assetId);
      assert.equal(sent!.recipient, BASE_ADDRESS);
      assert.equal(sent!.refundTo, ana.account, "a failed cash-out comes back to the person's own account");
      assert.equal(chain.balances.get(ana.account!), 5n * DOLLAR);
      assert.equal(chain.balances.get(DEPOSIT), 5n * DOLLAR);
      assert.deepEqual(oneClick.submitted, [{ txHash: body.ref, depositAddress: DEPOSIT, nearSenderAccount: ana.account }]);

      const [entry] = await feed(ana);
      assert.equal(entry!.kind, "cashout");
      assert.equal(entry!.counterparty, "0x5aAeb6…1BeAed on Base");
    });

    test("a quote for a different amount is refused before anything is signed", async () => {
      await signIn(ana);
      chain.fund(ana.account!, 10n * DOLLAR);
      oneClick.amountInOverride = "6000000";
      const res = await prepare(ana, { amount: "5", toChain: { assetId: BASE_USDC.assetId, address: BASE_ADDRESS } });
      assert.equal(res.statusCode, 502);
      assert.equal(chain.balances.get(ana.account!), 10n * DOLLAR);
    });

    test("a cash-out bigger than the balance never asks 1Click", async () => {
      await signIn(ana);
      chain.fund(ana.account!, 2n * DOLLAR);
      const res = await prepare(ana, { amount: "5", toChain: { assetId: BASE_USDC.assetId, address: BASE_ADDRESS } });
      assert.equal(res.statusCode, 409, res.body);
      assert.equal(oneClick.quotes.length, 0);
    });
  });
});

describe("Cash out to a bank: Paycrest, paid through NEAR Intents", () => {
  const NEAR_USDC = { assetId: "nep141:usdc.test", decimals: 6, blockchain: "near", symbol: "USDC", contractAddress: "usdc.test" };
  const BASE_USDC = { assetId: "nep141:base-usdc.omft.near", decimals: 6, blockchain: "base", symbol: "USDC", contractAddress: "0x8335" };
  const DEPOSIT = "b".repeat(64);
  const SECRET = "paycrest-test-secret";

  /** 1Click for this route: exact-output quotes cost 0.2% more than what lands. */
  class FakeOneClick {
    quotes: OneClickQuoteRequest[] = [];
    submitted: unknown[] = [];
    swap: OneClickStatus["status"] = "PROCESSING";
    async tokens(): Promise<OneClickToken[]> {
      return [NEAR_USDC, BASE_USDC];
    }
    async quote(request: OneClickQuoteRequest): Promise<OneClickQuote> {
      this.quotes.push(request);
      const amountIn = request.swapType === "EXACT_OUTPUT" ? (BigInt(request.amount) * 1002n) / 1000n : BigInt(request.amount);
      return {
        amountIn: amountIn.toString(),
        amountInFormatted: fromBaseUnits(amountIn, 6),
        amountOut: request.amount,
        amountOutFormatted: fromBaseUnits(request.amount, 6),
        timeEstimate: 25,
        depositAddress: request.dry ? undefined : DEPOSIT,
      };
    }
    async status(): Promise<OneClickStatus> {
      return { status: this.swap, swapDetails: {} };
    }
    async submitDeposit(input: unknown): Promise<void> {
      this.submitted.push(input);
    }
  }

  interface FakeOrder {
    id: string;
    status: string;
    rate: string;
    amount: string;
    reference: string;
    providerAccount: Record<string, string>;
  }

  /** Paycrest's API as the docs describe it, answered from memory. */
  function fakePaycrest() {
    const state = {
      orders: new Map<string, FakeOrder>(),
      bodies: [] as Record<string, unknown>[],
      refuse: null as string | null,
    };
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const fetch = (async (url: string | URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const method = init?.method ?? "GET";
      if (method === "GET" && path === "/v2/institutions/NGN") {
        return json(200, {
          status: "success",
          message: "OK",
          data: [
            { name: "Guaranty Trust Bank", code: "GTBINGLA", type: "bank" },
            { name: "Access Bank", code: "ABNGNGLA", type: "bank" },
          ],
        });
      }
      if (method === "POST" && path === "/v2/verify-account") {
        const body = JSON.parse(String(init?.body));
        if (body.accountIdentifier === "0000000000") return json(400, { status: "error", message: "Account could not be verified", data: null });
        return json(200, { status: "success", message: "Account name was resolved successfully", data: "ANA OKAFOR" });
      }
      if (method === "GET" && path.startsWith("/v2/rates/base/USDC/")) {
        return json(200, { status: "success", message: "Rate fetched successfully", data: { sell: { rate: "1398.05", providerIds: ["p1"] } } });
      }
      if (method === "POST" && path === "/v2/sender/orders") {
        assert.equal((init?.headers as Record<string, string>)["API-Key"], "paycrest-test-key");
        const body = JSON.parse(String(init?.body));
        state.bodies.push(body);
        if (state.refuse) return json(403, { status: "error", message: state.refuse, data: null });
        const id = `order-${state.orders.size + 1}`;
        const order: FakeOrder = {
          id,
          status: "initiated",
          rate: "1398.05",
          amount: body.amount,
          reference: body.reference,
          providerAccount: {
            network: "base",
            receiveAddress: "0xPaycrestReceive",
            validUntil: new Date(Date.now() + 15 * 60_000).toISOString(),
            amountToTransfer: (Number(body.amount) + 0.05).toFixed(2),
            currency: "USDC",
          },
        };
        state.orders.set(id, order);
        return json(201, { status: "success", message: "Payment order initiated successfully", data: order });
      }
      const found = path.match(/^\/v2\/sender\/orders\/(.+)$/);
      if (method === "GET" && found) {
        const order = state.orders.get(found[1]!);
        return order ? json(200, { status: "success", data: order }) : json(404, { status: "error", message: "Payment order not found", data: null });
      }
      return json(404, { status: "error", message: `no route ${method} ${path}`, data: null });
    }) as typeof globalThis.fetch;
    return { state, fetch };
  }

  let oneClick: FakeOneClick;
  let paycrest: ReturnType<typeof fakePaycrest>;
  const ana = person("9101", "ana_b");
  const tunde = person("9102", "tunde_b");

  async function build(network: "testnet" | "mainnet", keyed: boolean) {
    (chain.config as { network: string }).network = network;
    oneClick = new FakeOneClick();
    paycrest = fakePaycrest();
    await app.close();
    app = await buildNearApp({
      ...appDeps,
      intents: oneClick as unknown as OneClickClient,
      paycrest: new PaycrestClient({
        fetch: paycrest.fetch,
        network: "base",
        ...(keyed ? { apiKey: "paycrest-test-key", apiSecret: SECRET, refundAddress: "0xSelkieRefund" } : {}),
      }),
    });
  }

  const post = (who: Person, url: string, payload: object) => app.inject({ method: "POST", url, headers: auth(who), payload });
  const toBank = (extra: Record<string, unknown> = {}) => ({
    amount: "10",
    toBank: { currency: "NGN", institution: "GTBINGLA", accountIdentifier: "0123456789", accountName: "ANA OKAFOR", maxSend: "10.40", ...extra },
  });

  describe("on testnet: real banks, rates and names, nothing sent", () => {
    beforeEach(() => build("testnet", true));

    test("banks, the name check and a rate all work, labelled as a preview", async () => {
      await signIn(ana);
      const banks = await app.inject({ method: "GET", url: "/near/bank/institutions?currency=NGN", headers: auth(ana) });
      assert.equal(banks.statusCode, 200, banks.body);
      assert.deepEqual(banks.json().institutions.map((bank: { code: string }) => bank.code), ["GTBINGLA", "ABNGNGLA"]);

      const name = await post(ana, "/near/bank/verify", { currency: "NGN", institution: "GTBINGLA", accountIdentifier: "0123 456 789" });
      assert.equal(name.statusCode, 200, name.body);
      assert.deepEqual(name.json(), { institution: "GTBINGLA", institutionName: "Guaranty Trust Bank", accountName: "ANA OKAFOR" });
      const wrong = await post(ana, "/near/bank/verify", { currency: "NGN", institution: "GTBINGLA", accountIdentifier: "0000000000" });
      assert.equal(wrong.statusCode, 400);
      assert.equal(wrong.json().error, "Account could not be verified", "Paycrest's own words");

      const quote = await post(ana, "/near/bank/quote", { currency: "NGN", amount: "10" });
      assert.equal(quote.statusCode, 200, quote.body);
      const view = quote.json();
      assert.equal(view.payoutsOn, false);
      assert.match(view.note, /mainnet/);
      assert.equal(view.rate, "1398.05");
      assert.equal(view.fiatAmount, "13980.50");
      assert.equal(view.sendAbout, "10.02");
      assert.equal(view.sendAtMost, "10.27", "slack covers Paycrest's fee, which only the order knows");
      const [dry] = oneClick.quotes;
      assert.equal(dry!.dry, true);
      assert.equal(dry!.swapType, "EXACT_OUTPUT");
      assert.equal(dry!.refundTo, PREVIEW_ACCOUNT);
    });

    test("pressing send makes no Paycrest order and moves nothing", async () => {
      await signIn(ana);
      chain.fund(ana.account!, 20n * DOLLAR);
      const res = await prepare(ana, toBank());
      assert.equal(res.statusCode, 409);
      assert.match(res.json().error, /mainnet/);
      assert.equal(paycrest.state.bodies.length, 0);
    });
  });

  describe("on mainnet with no Paycrest key", () => {
    beforeEach(() => build("mainnet", false));

    test("rates still show, and the app is told bank payouts are not on yet", async () => {
      await signIn(ana);
      chain.fund(ana.account!, 20n * DOLLAR);
      const quote = (await post(ana, "/near/bank/quote", { currency: "NGN", amount: "10" })).json();
      assert.equal(quote.payoutsOn, false);
      assert.match(quote.note, /aren't switched on yet/);
      const res = await prepare(ana, toBank());
      assert.equal(res.statusCode, 409);
      assert.match(res.json().error, /aren't switched on yet/);
    });
  });

  describe("on mainnet with Paycrest on", () => {
    beforeEach(() => build("mainnet", true));

    test("one signature pays the Paycrest order through an exact-output swap", async () => {
      await signIn(ana);
      chain.fund(ana.account!, 20n * DOLLAR);
      const res = await pay(ana, toBank());
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json();
      assert.equal(body.status, "confirmed");
      assert.equal(body.message, "On its way: about 13980.50 NGN to Guaranty Trust Bank ••6789.");
      assert.deepEqual(body.bank, {
        orderId: "order-1",
        depositAddress: DEPOSIT,
        currency: "NGN",
        fiatAmount: "13980.50",
        institutionName: "Guaranty Trust Bank",
        accountLast4: "6789",
      });

      const [order] = paycrest.state.bodies;
      assert.equal(order!.amount, "10");
      assert.deepEqual(order!.source, { type: "crypto", currency: "USDC", network: "base", refundAddress: "0xSelkieRefund" });
      assert.deepEqual((order!.destination as { recipient: unknown }).recipient, {
        institution: "GTBINGLA",
        accountIdentifier: "0123456789",
        accountName: "ANA OKAFOR",
        memo: "Selkie cash out",
      });

      const swap = oneClick.quotes.at(-1)!;
      assert.equal(swap.swapType, "EXACT_OUTPUT");
      assert.equal(swap.dry, false);
      assert.equal(swap.amount, "10050000", "exactly what Paycrest asked for, fee included");
      assert.equal(swap.recipient, "0xPaycrestReceive");
      assert.equal(swap.refundTo, ana.account, "a swap that cannot fill comes back to the person");
      assert.equal(swap.destinationAsset, BASE_USDC.assetId);
      const validUntil = Date.parse(paycrest.state.orders.get("order-1")!.providerAccount.validUntil!);
      assert.ok(Date.parse(swap.deadline) <= validUntil - 2 * 60_000, "the swap is done before Paycrest's order runs out");

      // 10.05 * 1.002 = 10.0701 left; nothing more.
      assert.equal(chain.balances.get(DEPOSIT), 10_070_100n);
      assert.equal(chain.balances.get(ana.account!), 20n * DOLLAR - 10_070_100n);
      assert.deepEqual(oneClick.submitted, [{ txHash: body.ref, depositAddress: DEPOSIT, nearSenderAccount: ana.account }]);
      const [entry] = await feed(ana);
      assert.equal(entry!.kind, "cashout");
      assert.equal(entry!.counterparty, "Guaranty Trust Bank ••6789");
      assert.equal(entry!.amount.amount, "10.0701");
    });

    test("Paycrest's refusal is shown in its words, and nothing is quoted or signed", async () => {
      await signIn(ana);
      chain.fund(ana.account!, 20n * DOLLAR);
      paycrest.state.refuse = "Complete your business verification to start initiating payment orders";
      const res = await prepare(ana, toBank());
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error, "Complete your business verification to start initiating payment orders");
      assert.equal(oneClick.quotes.length, 0);
      assert.equal(chain.balances.get(ana.account!), 20n * DOLLAR);
    });

    test("a price above what the person agreed to is refused before signing", async () => {
      await signIn(ana);
      chain.fund(ana.account!, 20n * DOLLAR);
      const res = await prepare(ana, toBank({ maxSend: "10.05" }));
      assert.equal(res.statusCode, 409);
      assert.match(res.json().error, /price moved: it now takes 10\.0701 USDC/);
    });

    test("bad details are refused before Paycrest is asked", async () => {
      await signIn(ana);
      chain.fund(ana.account!, 20n * DOLLAR);
      for (const extra of [{ currency: "USD" }, { institution: "NOTABANK" }, { accountIdentifier: "12ab" }, { accountName: "  " }, { maxSend: "" }]) {
        const res = await prepare(ana, toBank(extra));
        assert.equal(res.statusCode, 400, `${JSON.stringify(extra)}: ${res.body}`);
      }
      assert.equal(paycrest.state.bodies.length, 0);
      const poor = await prepare(ana, { ...toBank(), amount: "50" });
      assert.equal(poor.statusCode, 409, "more than the balance");
      assert.equal(paycrest.state.bodies.length, 0);
    });

    test("status joins the swap and Paycrest, and only the person who cashed out can read it", async () => {
      await signIn(ana);
      await signIn(tunde);
      chain.fund(ana.account!, 20n * DOLLAR);
      const { bank } = (await pay(ana, toBank())).json();
      const read = (who: Person) =>
        app.inject({ method: "GET", url: `/near/bank/status?orderId=${bank.orderId}&depositAddress=${bank.depositAddress}`, headers: auth(who) });

      let status = (await read(ana)).json();
      assert.equal(status.stage, "swapping");
      assert.equal(status.done, false);

      oneClick.swap = "SUCCESS";
      paycrest.state.orders.get(bank.orderId)!.status = "deposited";
      assert.equal((await read(ana)).json().stage, "paying");

      paycrest.state.orders.get(bank.orderId)!.status = "settled";
      status = (await read(ana)).json();
      assert.equal(status.stage, "paid");
      assert.equal(status.done, true);
      assert.equal(status.paycrest.fiatAmount, "13980.50");

      assert.equal((await read(tunde)).statusCode, 404, "someone else's order is not there for them");
      const junk = await app.inject({ method: "GET", url: "/near/bank/status?orderId=../../x", headers: auth(ana) });
      assert.equal(junk.statusCode, 400);
    });

    test("a failed swap reads as money back in the person's account", async () => {
      await signIn(ana);
      chain.fund(ana.account!, 20n * DOLLAR);
      const { bank } = (await pay(ana, toBank())).json();
      oneClick.swap = "REFUNDED";
      const status = (
        await app.inject({ method: "GET", url: `/near/bank/status?orderId=${bank.orderId}&depositAddress=${bank.depositAddress}`, headers: auth(ana) })
      ).json();
      assert.equal(status.stage, "back-to-you");
      assert.equal(status.done, true);
    });

    test("webhooks count only with Paycrest's signature over the raw body", async () => {
      await signIn(ana);
      chain.fund(ana.account!, 20n * DOLLAR);
      const { bank } = (await pay(ana, toBank())).json();
      const raw = JSON.stringify({ event: "payment_order.settled", webhookVersion: "2", data: { id: bank.orderId, status: "settled" } });
      const hook = (signature: string) =>
        app.inject({
          method: "POST",
          url: "/near/bank/webhook",
          headers: { "content-type": "application/json", "x-paycrest-signature": signature },
          payload: raw,
        });

      const forged = await hook(createHmac("sha256", "not-the-secret").update(raw).digest("hex"));
      assert.equal(forged.statusCode, 401);
      const good = await hook(createHmac("sha256", SECRET).update(raw).digest("hex"));
      assert.equal(good.statusCode, 200, good.body);

      // Paycrest's API still says initiated; the signed webhook is ahead of it.
      const status = (
        await app.inject({ method: "GET", url: `/near/bank/status?orderId=${bank.orderId}&depositAddress=${bank.depositAddress}`, headers: auth(ana) })
      ).json();
      assert.equal(status.stage, "paid");

      // Every other route still reads JSON as JSON.
      assert.equal((await post(ana, "/near/bank/quote", { currency: "NGN", amount: "1" })).statusCode, 200);
    });
  });

  test("with no Paycrest at all, the bank routes say they are off", async () => {
    await signIn(ana);
    const res = await app.inject({ method: "GET", url: "/near/bank/institutions?currency=NGN", headers: auth(ana) });
    assert.equal(res.statusCode, 503);
  });
});

describe("The X pocket: a tweet pays from a small, capped balance", () => {
  const BOT_SECRET = "b".repeat(MIN_BOT_SECRET_LENGTH);
  const ada = person("7001", "ada_p");
  const bayo = person("7002", "bayo_p");
  let tweet = 1_000_000;

  async function build(options: { pocket?: boolean; canSend?: boolean; secret?: string | null } = {}) {
    await app.close();
    app = await buildNearApp({
      ...appDeps,
      ...(options.pocket === false ? {} : { pocket: chain.pocketChain({ canSend: options.canSend }) }),
      botSecret: options.secret === undefined ? BOT_SECRET : options.secret,
    });
  }

  const pocketOf = async (who: Person) => {
    const res = await app.inject({ method: "GET", url: "/near/pocket", headers: auth(who) });
    assert.equal(res.statusCode, 200, res.body);
    return res.json();
  };
  const pocketPrepare = (who: Person, pocket: Record<string, unknown>) => prepare(who, { pocket });
  const pocketPay = (who: Person, pocket: Record<string, unknown>) => pay(who, { pocket });

  /** What the bot sends when somebody tweets "@SelkiePay send 2 to @bayo_p". */
  function botSend(body: Record<string, unknown> = {}, headers: Record<string, string> = { "x-selkie-bot-secret": BOT_SECRET }) {
    return app.inject({
      method: "POST",
      url: "/near/bot/send",
      headers,
      payload: {
        tweetId: String(++tweet),
        senderXUserId: ada.subject,
        senderHandle: ada.username,
        to: bayo.username,
        amount: "2",
        ...body,
      },
    });
  }

  /** Ada and Bayo on Selkie, Ada with $20 and a pocket topped up as asked. */
  async function twoPeople(topUp?: { amount: string; dailyCap?: string }) {
    await signIn(ada);
    await signIn(bayo);
    chain.fund(ada.account!, 20n * DOLLAR);
    if (topUp) {
      const res = await pocketPay(ada, { action: "top_up", ...topUp });
      assert.equal(res.statusCode, 200, res.body);
    }
  }

  /** A delegate the web app never offers, signed by the user's own key, smuggled into the prepare store. */
  async function relayForged(who: Person, receiverId: string, methodName: string, args: object) {
    const user = (await signIn(who)).user;
    const key = (await accounts.findByXUserId(who.subject))!.publicKey;
    const delegate = await chain.prepare(who.account!, key, {
      receiverId,
      calls: [preparedCall(methodName, args, 30n * TGAS, 1n)],
    });
    const record = await appDeps.prepares.create({
      userId: user.id,
      delegate,
      intent: { kind: "pocket", action: "set_cap", amount: { amount: "0", asset: "USDC" } },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const signedDelegate = await signFor(who, delegate);
    return app.inject({
      method: "POST",
      url: "/near/relay",
      headers: auth(who),
      payload: { prepareId: record.id, signedDelegate },
    });
  }

  describe("switched off (no NEAR_POCKET_CONTRACT)", () => {
    beforeEach(() => build({ pocket: false }));

    test("GET /near/pocket says so, prepares are refused and the bot route is not there", async () => {
      await twoPeople();
      assert.deepEqual(await pocketOf(ada), { enabled: false, contract: null, bot: "SelkiePay", pocket: null });
      const top = await pocketPrepare(ada, { action: "top_up", amount: "5" });
      assert.equal(top.statusCode, 503);
      assert.equal((await botSend()).statusCode, 404);
    });

    test("the relayer pays for no pocket call", async () => {
      await twoPeople();
      const res = await relayForged(ada, "pocket.test", "pocket_withdraw", { amount: "1" });
      assert.equal(res.statusCode, 400, res.body);
      assert.equal(chain.relayed.length, 0);
    });
  });

  describe("switched on", () => {
    beforeEach(() => build());

    test("GET /near/pocket needs a sign-in, and shows no pocket before the first top-up", async () => {
      await twoPeople();
      assert.equal((await app.inject({ method: "GET", url: "/near/pocket" })).statusCode, 401);
      assert.deepEqual(await pocketOf(ada), { enabled: true, contract: "pocket.test", bot: "SelkiePay", pocket: null });
    });

    test("a top-up signs exactly USDC.ft_transfer_call to the pocket, and shows in dollars", async () => {
      await twoPeople();
      const prepared = await pocketPrepare(ada, { action: "top_up", amount: "12.5", dailyCap: "5" });
      assert.equal(prepared.statusCode, 200, prepared.body);
      const { delegate, intent } = prepared.json();
      assert.equal(delegate.receiverId, "usdc.test");
      assert.deepEqual(delegate.calls, pocketTopUp("usdc.test", "pocket.test", { amount: "12500000", dailyCap: "5000000" }).calls);
      assert.equal(intent.kind, "pocket");

      const res = await pocketPay(ada, { action: "top_up", amount: "12.5", dailyCap: "5" });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().status, "confirmed");
      assert.deepEqual((await pocketOf(ada)).pocket, { balance: "12.5", dailyCap: "5", spentToday: "0", leftToday: "5" });
      assert.equal(await chain.usdcBalance(ada.account!), 7_500_000n);

      const [line] = await feed(ada);
      assert.equal(line!.kind, "send");
      assert.equal(line!.counterparty, "your X pocket");
      assert.equal(line!.amount.amount, "12.5");
      // Selkie moved it, so it is never "money from outside": only the faucet's $20 is.
      await settle(ada);
      assert.deepEqual(outsideLines(await fromOutside(ada)), ["receive 20"]);
    });

    test("a top-up with no daily limit gets the default of 10 a day", async () => {
      await twoPeople();
      const { delegate } = (await pocketPrepare(ada, { action: "top_up", amount: "3" })).json();
      assert.deepEqual(delegate.calls, pocketTopUp("usdc.test", "pocket.test", { amount: "3000000" }).calls);
      await pocketPay(ada, { action: "top_up", amount: "3" });
      assert.deepEqual((await pocketOf(ada)).pocket, { balance: "3", dailyCap: "10", spentToday: "0", leftToday: "3" });
    });

    test("a top-up bigger than the balance is refused before anything is signed", async () => {
      await twoPeople();
      assert.equal((await pocketPrepare(ada, { action: "top_up", amount: "25" })).statusCode, 409);
      assert.equal((await pocketPrepare(ada, { action: "top_up", amount: "0" })).statusCode, 400);
    });

    test("withdraw some, then all of it, each signing exactly pocket_withdraw", async () => {
      await twoPeople({ amount: "10" });

      const some = (await pocketPrepare(ada, { action: "withdraw", amount: "4" })).json();
      assert.equal(some.delegate.receiverId, "pocket.test");
      assert.deepEqual(some.delegate.calls, pocketWithdraw("pocket.test", { amount: "4000000" }).calls);
      assert.equal((await pocketPay(ada, { action: "withdraw", amount: "4" })).statusCode, 200);
      assert.equal((await pocketOf(ada)).pocket.balance, "6");
      assert.equal(await chain.usdcBalance(ada.account!), 14n * DOLLAR);

      // "All" is named exactly, as it stands when prepared.
      const all = (await pocketPrepare(ada, { action: "withdraw" })).json();
      assert.deepEqual(all.delegate.calls, pocketWithdraw("pocket.test", { amount: "6000000" }).calls);
      const res = await pocketPay(ada, { action: "withdraw" });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal((await pocketOf(ada)).pocket.balance, "0");
      assert.equal(await chain.usdcBalance(ada.account!), 20n * DOLLAR);
      const [line] = await feed(ada);
      assert.equal(line!.kind, "receive");
      assert.equal(line!.counterparty, "your X pocket");
      assert.equal(line!.amount.amount, "6");

      assert.equal((await pocketPrepare(ada, { action: "withdraw" })).statusCode, 409, "nothing left");
      await settle(ada);
      assert.deepEqual(outsideLines(await fromOutside(ada)), ["receive 20"]);
    });

    test("withdrawing more than the pocket holds is refused", async () => {
      await twoPeople({ amount: "3" });
      const res = await pocketPrepare(ada, { action: "withdraw", amount: "5" });
      assert.equal(res.statusCode, 409);
      assert.match(res.json().error, /\$3/);
    });

    test("change the daily limit, signing exactly pocket_set_cap", async () => {
      await twoPeople();
      assert.equal((await pocketPrepare(ada, { action: "set_cap", dailyCap: "5" })).statusCode, 409, "no pocket yet");

      await pocketPay(ada, { action: "top_up", amount: "8" });
      const { delegate } = (await pocketPrepare(ada, { action: "set_cap", dailyCap: "2.5" })).json();
      assert.equal(delegate.receiverId, "pocket.test");
      assert.deepEqual(delegate.calls, pocketSetCap("pocket.test", { dailyCap: "2500000" }).calls);
      const res = await pocketPay(ada, { action: "set_cap", dailyCap: "2.5" });
      assert.equal(res.statusCode, 200, res.body);
      assert.deepEqual((await pocketOf(ada)).pocket, { balance: "8", dailyCap: "2.5", spentToday: "0", leftToday: "2.5" });

      assert.equal((await pocketPrepare(ada, { action: "set_cap" })).statusCode, 400);
      assert.equal((await pocketPrepare(ada, { action: "spend_it_all" })).statusCode, 400);
    });

    test("the relayer still refuses every other pocket method", async () => {
      await twoPeople({ amount: "10" });
      const before = chain.relayed.length;
      for (const [method, args] of [
        ["pocket_send", { owner: ada.account, to: bayo.account, amount: "1000000" }],
        ["set_bot", { bot: ada.account }],
        ["ft_on_transfer", { sender_id: ada.account, amount: "1000000", msg: '{"kind":"top_up"}' }],
      ] as const) {
        const res = await relayForged(ada, "pocket.test", method, args);
        assert.equal(res.statusCode, 400, `${method}: ${res.body}`);
      }
      assert.equal(chain.relayed.length, before);
      assert.equal((await pocketOf(ada)).pocket.balance, "10");

      // The same smuggling path with an allowed method does go through, so the
      // refusals above are the relay policy and not the route.
      const allowed = await relayForged(ada, "pocket.test", "pocket_set_cap", { daily_cap: "3000000" });
      assert.equal(allowed.statusCode, 200, allowed.body);
      assert.equal((await pocketOf(ada)).pocket.dailyCap, "3");
    });

    test("paying the pocket contract as if it were a person is refused", async () => {
      await twoPeople();
      chain.addContractAccount("pocket.test");
      const res = await prepare(ada, { toAccount: "pocket.test", amount: "1", toContract: true });
      assert.equal(res.statusCode, 400);
    });
  });

  describe("POST /near/bot/send", () => {
    test("is not there without the bot secret, or without a bot key", async () => {
      await build({ secret: null });
      await twoPeople({ amount: "10" });
      assert.equal((await botSend()).statusCode, 404);
      await build({ canSend: false });
      assert.equal((await botSend()).statusCode, 404);
      assert.equal(chain.pocketSends.length, 0);
    });

    describe("with the pocket and the secret", () => {
      beforeEach(() => build());

      test("refuses a wrong or missing secret, and nothing moves", async () => {
        await twoPeople({ amount: "10" });
        assert.equal((await botSend({}, { "x-selkie-bot-secret": "c".repeat(MIN_BOT_SECRET_LENGTH) })).statusCode, 401);
        assert.equal((await botSend({}, { "x-selkie-bot-secret": BOT_SECRET.slice(1) })).statusCode, 401);
        assert.equal((await botSend({}, {})).statusCode, 401);
        assert.equal(chain.pocketSends.length, 0);
        assert.equal((await pocketOf(ada)).pocket.balance, "10");
      });

      test("refuses a body it cannot read", async () => {
        await twoPeople({ amount: "10" });
        assert.equal((await botSend({ tweetId: "" })).statusCode, 400);
        assert.equal((await botSend({ senderXUserId: "ada" })).statusCode, 400);
        assert.equal((await botSend({ to: "" })).statusCode, 400);
        assert.equal((await botSend({ amount: "-1" })).statusCode, 400);
        assert.equal((await botSend({ amount: "0" })).statusCode, 400);
        assert.equal(chain.pocketSends.length, 0);
      });

      test("sent: straight from the pocket to their account, a line on each side", async () => {
        await twoPeople({ amount: "10", dailyCap: "5" });
        const res = await botSend({ amount: "2" });
        assert.equal(res.statusCode, 200, res.body);
        const body = res.json();
        assert.deepEqual(body, {
          status: "sent",
          txHash: body.txHash,
          explorerUrl: `https://explorer.test/transactions/${body.txHash}`,
          amount: "2",
          to: "bayo_p",
          toAccount: bayo.account,
          leftToday: "3",
        });
        assert.equal(await chain.usdcBalance(bayo.account!), 2n * DOLLAR);
        assert.equal(await chain.usdcBalance(ada.account!), 10n * DOLLAR, "the account itself is untouched");
        assert.deepEqual((await pocketOf(ada)).pocket, { balance: "8", dailyCap: "5", spentToday: "2", leftToday: "3" });
        assert.equal(chain.pocketSends[0]!.memo, "Sent from X");

        const [sent] = await feed(ada);
        assert.equal(sent!.kind, "send");
        assert.equal(sent!.counterparty, "@bayo_p");
        assert.equal(sent!.status, "confirmed");
        const [got] = await feed(bayo);
        assert.equal(got!.kind, "receive");
        assert.equal(got!.counterparty, "@ada_p");
        assert.equal(got!.amount.amount, "2");
        // Selkie moved it, so Bayo's feed never calls it "from outside".
        await settle(bayo);
        assert.equal((await fromOutside(bayo)).length, 0);
      });

      test("a note in the tweet goes on chain as the memo", async () => {
        await twoPeople({ amount: "10" });
        assert.equal((await botSend({ note: "for lunch" })).json().status, "sent");
        assert.equal(chain.pocketSends[0]!.memo, "for lunch");
      });

      test("no-account: the tweeter never signed in", async () => {
        await twoPeople({ amount: "10" });
        const body = (await botSend({ senderXUserId: "7999" })).json();
        assert.equal(body.status, "no-account");
        assert.equal(chain.pocketSends.length, 0);
      });

      test("not-on-selkie: the pocket only pays people already on Selkie", async () => {
        await twoPeople({ amount: "10" });
        assert.equal((await botSend({ to: "@nobody_here" })).json().status, "not-on-selkie");
        assert.equal(chain.pocketSends.length, 0);
      });

      test("no-pocket: never topped up", async () => {
        await twoPeople();
        assert.equal((await botSend()).json().status, "no-pocket");
      });

      test("low-balance: says what is left today", async () => {
        await twoPeople({ amount: "3" });
        assert.deepEqual(pick((await botSend({ amount: "5" })).json()), { status: "low-balance", leftToday: "3" });
        assert.equal(chain.pocketSends.length, 0);
      });

      test("over-cap: says what is left today, and tomorrow the limit is back", async () => {
        await twoPeople({ amount: "10", dailyCap: "2" });
        assert.equal((await botSend({ amount: "1.5" })).json().leftToday, "0.5");
        assert.deepEqual(pick((await botSend({ amount: "1" })).json()), { status: "over-cap", leftToday: "0.5" });
        chain.pocketDayOffset = 1;
        assert.equal((await botSend({ amount: "1" })).json().status, "sent");
        assert.equal(await chain.usdcBalance(bayo.account!), 2_500_000n);
      });

      test("failed: the transfer did not go, nothing changes and nothing is written", async () => {
        await twoPeople({ amount: "10" });
        const linesBefore = (await feed(ada)).length;
        chain.failNextPocketSend = true;
        const body = (await botSend()).json();
        assert.equal(body.status, "failed");
        assert.ok(body.message);
        assert.equal((await pocketOf(ada)).pocket.balance, "10");
        assert.equal(await chain.usdcBalance(bayo.account!), 0n);
        assert.equal((await feed(ada)).length, linesBefore);
        assert.equal((await feed(bayo)).length, 0);
      });

      test("paying yourself is refused", async () => {
        await twoPeople({ amount: "10" });
        assert.equal((await botSend({ to: "ada_p" })).json().status, "failed");
        assert.equal(chain.pocketSends.length, 0);
      });

      test("the same tweet twice gets the first answer and pays once", async () => {
        await twoPeople({ amount: "10" });
        const once = await botSend({ tweetId: "555" });
        const twice = await botSend({ tweetId: "555" });
        assert.equal(once.json().status, "sent");
        assert.deepEqual(twice.json(), once.json());
        assert.equal(chain.pocketSends.length, 1);
        assert.equal(await chain.usdcBalance(bayo.account!), 2n * DOLLAR);
        assert.equal((await feed(bayo)).length, 1);

        // Somebody else naming the same tweet gets nothing.
        assert.equal((await botSend({ tweetId: "555", senderXUserId: bayo.subject, to: "ada_p" })).statusCode, 409);
      });

      test("a repeat keeps the first answer even after things change", async () => {
        await twoPeople();
        assert.equal((await botSend({ tweetId: "777" })).json().status, "no-pocket");
        await pocketPay(ada, { action: "top_up", amount: "10" });
        assert.equal((await botSend({ tweetId: "777" })).json().status, "no-pocket");
        assert.equal(chain.pocketSends.length, 0);
      });
    });
  });
});

function outsideLines(entries: { kind: string; amount: { amount: string } }[]) {
  return entries.map((entry) => `${entry.kind} ${entry.amount.amount}`);
}

/** A bot-send answer without its words, which are the bot's to choose. */
function pick(body: { status: string; leftToday?: string }) {
  return { status: body.status, leftToday: body.leftToday };
}

describe("A tweeted ask: \"@SelkiePay request 5 from @amaka\" is the request itself", () => {
  const BOT_SECRET = "r".repeat(MIN_BOT_SECRET_LENGTH);
  const cleo = person("7101", "cleo_r");
  const dayo = person("7102", "dayo_r");
  let tweet = 2_000_000;

  async function build(secret: string | null = BOT_SECRET) {
    await app.close();
    app = await buildNearApp({ ...appDeps, botSecret: secret });
  }

  /** What the bot sends when Cleo tweets "@SelkiePay request 0.05 from @dayo_r". */
  function botAsk(body: Record<string, unknown> = {}, headers: Record<string, string> = { "x-selkie-bot-secret": BOT_SECRET }) {
    return app.inject({
      method: "POST",
      url: "/near/bot/request",
      headers,
      payload: { tweetId: String(++tweet), senderXUserId: cleo.subject, from: dayo.username, amount: "0.05", ...body },
    });
  }

  test("makes the ask at once, and the person asked finds it waiting when they sign in", async () => {
    await build();
    await signIn(cleo);
    const res = await botAsk();
    assert.equal(res.statusCode, 200, res.body);
    const { id, ...rest } = res.json();
    assert.ok(id);
    assert.deepEqual(rest, { status: "asked", from: "dayo_r", amount: "0.05" });

    // Dayo had never used Selkie; the ask waits for the handle, not an account.
    await signIn(dayo);
    const incoming = (await app.inject({ method: "GET", url: "/requests", headers: auth(dayo) })).json().incoming;
    assert.equal(incoming.length, 1);
    assert.equal(incoming[0].id, id);
    assert.equal(incoming[0].amount.amount, "0.05");
    assert.equal(incoming[0].fromHandle.username, "cleo_r");
  });

  test("one ask per tweet, however many times the bot reads it", async () => {
    await build();
    await signIn(cleo);
    const payload = { tweetId: "2999999" };
    const first = (await botAsk(payload)).json();
    const again = (await botAsk(payload)).json();
    assert.deepEqual(again, first);
    assert.equal((await requests.sentBy((await signIn(cleo)).user.id)).length, 1);
  });

  test("someone who never signed in to Selkie is told to, and nothing is asked", async () => {
    await build();
    const res = (await botAsk()).json();
    assert.equal(res.status, "no-account");
    assert.equal((await requests.addressedTo([{ platform: "x", username: "dayo_r" }])).length, 0);
  });

  test("the same rules as the web form: not yourself, not a name X would never allow", async () => {
    await build();
    await signIn(cleo);
    assert.deepEqual((await botAsk({ from: "cleo_r" })).json(), { status: "failed", message: "That is your own handle. Pick someone else." });
    assert.equal((await botAsk({ from: "dayo.x.selkiepay.testnet" })).json().status, "failed");
  });

  test("only the bot: a wrong secret is refused, and with no secret the route is off", async () => {
    await build();
    await signIn(cleo);
    assert.equal((await botAsk({}, { "x-selkie-bot-secret": "x".repeat(MIN_BOT_SECRET_LENGTH) })).statusCode, 401);
    assert.equal((await botAsk({ tweetId: "not-a-tweet" })).statusCode, 400);
    await build(null);
    assert.equal((await botAsk()).statusCode, 404);
  });
});
