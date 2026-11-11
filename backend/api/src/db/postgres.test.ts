import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { LinkedIdentity } from "../identity/types";
import { PostgresAccountDirectory } from "../accounts/postgres-directory";
import { PostgresActivityStore } from "../activity/postgres-store";
import { ActivityNotFoundError } from "../activity/store";
import { PostgresUserStore } from "../identity/postgres-store";
import { IdentityAlreadyLinkedError } from "../identity/store";
import { PostgresIdempotencyStore } from "../idempotency/postgres-store";
import { PostgresRequestStore } from "../requests/postgres-store";
import { PostgresSigners } from "../wallets/postgres";
import { Seal } from "./seal";
import { openTestDatabase, someone, testDatabaseUrl, type TestDatabase } from "./testing";

/**
 * The storage layer, against a real Postgres.
 *
 * These are the tests the in-memory stores could never have: a primary key
 * refusing a second row, a check constraint rejecting a shape, two connections
 * racing for the same idempotency key. Every one of them is a way somebody's
 * money goes missing, and the point of moving off a JSON file was that the
 * database refuses them rather than the code remembering to.
 */

const url = testDatabaseUrl();
const skip = url
  ? false
  : "DATABASE_URL_TEST is not set. Point it at a scratch database to run these.";

const login = (over: Partial<LinkedIdentity> = {}): LinkedIdentity => ({
  provider: "x",
  subject: randomUUID(),
  attestation: "login",
  username: "amaka",
  linkedAt: new Date().toISOString(),
  ...over,
});

const address = () => `G${randomBytes(20).toString("hex").toUpperCase()}`;

describe("Postgres storage", { skip }, () => {
  let db: TestDatabase;

  before(async () => {
    db = await openTestDatabase();
  });

  after(async () => {
    await db?.done();
  });

  describe("users and identities", () => {
    it("gives back what it was given, after a full round trip", async () => {
      const users = new PostgresUserStore(db.pool);
      const identity = login({ displayName: "Amaka", email: "amaka@example.com" });
      const created = await users.create({ address: address(), identities: [identity] });

      const read = await users.get(created.id);
      assert.deepEqual(read, created);
      assert.equal(read?.identities[0]?.displayName, "Amaka");
      assert.equal(read?.identities[0]?.email, "amaka@example.com");
      assert.equal(new Date(read!.createdAt).toISOString(), read!.createdAt);
    });

    it("leaves empty fields absent rather than explicitly undefined", async () => {
      // Not pedantry. `{ username: undefined }` claims there is a username and
      // it is empty, and code that checks `"username" in identity` then gets a
      // different answer from code that checks the value.
      const users = new PostgresUserStore(db.pool);
      const created = await users.create({
        address: address(),
        identities: [{ provider: "google", subject: randomUUID(), attestation: "login", linkedAt: new Date().toISOString() }],
      });

      const identity = (await users.get(created.id))!.identities[0]!;
      assert.equal("username" in identity, false);
      assert.equal("email" in identity, false);
      assert.equal("avatarUrl" in identity, false);
    });

    it("finds someone by the identity they signed in with", async () => {
      const users = new PostgresUserStore(db.pool);
      const identity = login();
      const created = await users.create({ address: address(), identities: [identity] });

      assert.equal((await users.findByIdentity("x", identity.subject))?.id, created.id);
      assert.equal(await users.findByIdentity("x", "nobody"), null);
      assert.equal(await users.findByIdentity("telegram", identity.subject), null);
    });

    it("routes a payment to a handle whatever case it was typed in", async () => {
      const users = new PostgresUserStore(db.pool);
      const created = await users.create({
        address: address(),
        identities: [login({ username: "Chidi" })],
      });

      for (const typed of ["chidi", "Chidi", "CHIDI", "ChIdI"]) {
        assert.equal((await users.findByHandle("x", typed))?.id, created.id, typed);
      }
    });

    it("gives a re-registered handle to whoever proved it most recently", async () => {
      // Handles get released and taken by somebody else. The stale row still
      // carries the name, and paying the person who last actually signed in is
      // the only reading that does not send money to a stranger.
      const users = new PostgresUserStore(db.pool);
      const old = await users.create({
        address: address(),
        identities: [login({ username: "traveller", linkedAt: "2024-01-01T00:00:00.000Z" })],
      });
      const now = await users.create({
        address: address(),
        identities: [login({ username: "traveller", linkedAt: "2026-01-01T00:00:00.000Z" })],
      });

      assert.equal((await users.findByHandle("x", "traveller"))?.id, now.id);
      assert.notEqual(now.id, old.id);
    });

    it("refuses to let one X account belong to two wallets", async () => {
      const users = new PostgresUserStore(db.pool);
      const shared = login();
      const first = await users.create({ address: address(), identities: [shared] });
      const second = await users.create({ address: address(), identities: [login()] });

      await assert.rejects(
        () => users.addIdentity(second.id, shared),
        (error: unknown) => {
          assert.ok(error instanceof IdentityAlreadyLinkedError);
          assert.equal(error.ownerId, first.id);
          return true;
        },
      );
    });

    it("refuses it at the database, not only in the code above it", async () => {
      // The reason the primary key is (provider, subject). If this were only
      // enforced in TypeScript, a second server, a migration script, or a fixed
      // bug in the wrong order could still split someone's money in two.
      const users = new PostgresUserStore(db.pool);
      const identity = login();
      await users.create({ address: address(), identities: [identity] });
      const other = await users.create({ address: address(), identities: [login()] });

      await assert.rejects(
        () =>
          db.pool.query(
            `insert into identities (provider, subject, user_id, attestation) values ('x', $1, $2, 'login')`,
            [identity.subject, other.id],
          ),
        (error: unknown) => (error as { code?: string }).code === "23505",
      );
    });

    it("refuses to give two people the same wallet address", async () => {
      const users = new PostgresUserStore(db.pool);
      const shared = address();
      await users.create({ address: shared, identities: [login()] });

      await assert.rejects(
        () => users.create({ address: shared, identities: [login()] }),
        (error: unknown) => (error as { code?: string }).code === "23505",
      );
    });

    it("leaves nothing behind when a user it half-created is rejected", async () => {
      // The insert above failed on the address. If the identity had gone in
      // anyway it would now be attached to a user row that does not exist, and
      // that person could never sign in again.
      const users = new PostgresUserStore(db.pool);
      const shared = address();
      await users.create({ address: shared, identities: [login()] });
      const orphan = login();

      await assert.rejects(() => users.create({ address: shared, identities: [orphan] }));
      assert.equal(await users.findByIdentity("x", orphan.subject), null);
    });

    it("picks up a rename instead of stacking up a second identity", async () => {
      const users = new PostgresUserStore(db.pool);
      const identity = login({ username: "oldname" });
      const created = await users.create({ address: address(), identities: [identity] });

      const renamed = await users.addIdentity(created.id, {
        ...identity,
        username: "newname",
        linkedAt: new Date().toISOString(),
      });

      assert.equal(renamed.identities.length, 1);
      assert.equal(renamed.identities[0]?.username, "newname");
      assert.equal((await users.findByHandle("x", "newname"))?.id, created.id);
    });

    it("only unlinks an identity from the account that holds it", async () => {
      const users = new PostgresUserStore(db.pool);
      const mine = login();
      const owner = await users.create({ address: address(), identities: [mine] });
      const stranger = await users.create({ address: address(), identities: [login()] });

      await users.removeIdentity(stranger.id, "x", mine.subject);

      assert.equal((await users.get(owner.id))?.identities.length, 1);
      assert.equal((await users.findByIdentity("x", mine.subject))?.id, owner.id);
    });

    it("takes the identities with the user when an account is deleted", async () => {
      const users = new PostgresUserStore(db.pool);
      const identity = login();
      const created = await users.create({ address: address(), identities: [identity] });

      await users.delete(created.id);

      assert.equal(await users.get(created.id), null);
      assert.equal(await users.findByIdentity("x", identity.subject), null);
    });

    it("keeps every door somebody can arrive through", async () => {
      const users = new PostgresUserStore(db.pool);
      const created = await users.create({
        address: address(),
        identities: [login({ provider: "google", username: undefined, email: "a@example.com" })],
      });

      const linked = await users.addIdentity(created.id, login({ username: "amaka2" }));
      assert.equal(linked.identities.length, 2);
      assert.deepEqual(
        linked.identities.map((i) => i.provider).sort(),
        ["google", "x"],
      );
      // One wallet, two ways in. This is the whole account model.
      assert.equal(linked.address, created.address);
    });
  });

  describe("the handle directory", () => {
    it("stores and finds a handle regardless of case", async () => {
      const directory = new PostgresAccountDirectory(db.pool);
      const at = address();
      await directory.save({ handle: { platform: "x", username: "Ngozi" }, address: at, provisioned: false });

      const found = await directory.lookup({ platform: "x", username: "NGOZI" });
      assert.equal(found?.address, at);
      assert.equal(found?.handle.username, "ngozi");
      assert.equal(found?.provisioned, false);
    });

    it("will not let an account stop existing on the ledger", async () => {
      // Once provisioned, always provisioned. A stale write setting this back
      // would make Selkie try to create an account that is already there.
      const directory = new PostgresAccountDirectory(db.pool);
      const handle = { platform: "x", username: "tunde" } as const;
      const at = address();

      await directory.save({ handle, address: at, provisioned: false });
      await directory.save({ handle, address: at, provisioned: true });
      await directory.save({ handle, address: at, provisioned: false });

      assert.equal((await directory.lookup(handle))?.provisioned, true);
    });

    it("answers the reverse lookup with the same handle every time", async () => {
      const directory = new PostgresAccountDirectory(db.pool);
      const at = address();
      await directory.save({ handle: { platform: "x", username: "first" }, address: at, provisioned: true });
      await directory.save({ handle: { platform: "telegram", username: "second" }, address: at, provisioned: true });

      const answers = await Promise.all([
        directory.lookupByAddress(at),
        directory.lookupByAddress(at),
        directory.lookupByAddress(at),
      ]);
      assert.deepEqual(new Set(answers.map((a) => a?.handle.username)), new Set(["first"]));
    });

    it("refuses a username that was not folded to lower case", async () => {
      await assert.rejects(
        () =>
          db.pool.query("insert into accounts (platform, username, address) values ('x', 'Shouty', $1)", [
            address(),
          ]),
        (error: unknown) => (error as { code?: string }).code === "23514",
      );
    });

    it("has nothing to say about a handle it has never seen", async () => {
      const directory = new PostgresAccountDirectory(db.pool);
      assert.equal(await directory.lookup({ platform: "x", username: "ghost" }), null);
      assert.equal(await directory.lookupByAddress(address()), null);
    });
  });

  describe("the activity feed", () => {
    const payment = (over: Record<string, unknown> = {}) =>
      ({
        kind: "send",
        chain: "stellar",
        amount: { amount: "5", asset: "USDC" },
        status: "pending",
        ...over,
      }) as Parameters<PostgresActivityStore["record"]>[1];

    it("reads back newest first", async () => {
      const activity = new PostgresActivityStore(db.pool);
      const user = await someone(db.pool);

      await activity.record(user.id, payment({ counterparty: "@one" }));
      await activity.record(user.id, payment({ counterparty: "@two" }));
      await activity.record(user.id, payment({ counterparty: "@three" }));

      const feed = await activity.list(user.id);
      assert.deepEqual(feed.map((entry) => entry.counterparty), ["@three", "@two", "@one"]);
    });

    it("does not reshuffle when entries share a timestamp", async () => {
      // Claiming several waiting payments at sign-in writes a burst of entries.
      // With a text id as the tie-break, 'act_9' sorted above 'act_10' and the
      // feed came back in a different order than it went in.
      const activity = new PostgresActivityStore(db.pool);
      const user = await someone(db.pool);
      const at = "2026-03-01T12:00:00.000Z";

      for (let n = 1; n <= 12; n++) {
        await activity.record(user.id, payment({ at, counterparty: `@p${n}`, kind: "claim" }));
      }

      const feed = await activity.list(user.id);
      assert.deepEqual(
        feed.map((entry) => entry.counterparty),
        Array.from({ length: 12 }, (_, i) => `@p${12 - i}`),
      );
    });

    it("shows one person only their own money", async () => {
      const activity = new PostgresActivityStore(db.pool);
      const mine = await someone(db.pool);
      const theirs = await someone(db.pool);

      await activity.record(mine.id, payment({ counterparty: "@mine" }));
      await activity.record(theirs.id, payment({ counterparty: "@theirs" }));

      assert.deepEqual((await activity.list(mine.id)).map((e) => e.counterparty), ["@mine"]);
    });

    it("keeps an amount exactly as it was written", async () => {
      // The reason the column is numeric. Through a double, this comes back as
      // 0.10000000000000001 and the fraction is gone for good.
      const activity = new PostgresActivityStore(db.pool);
      const user = await someone(db.pool);

      for (const amount of ["0.1", "0.0000001", "123456789.1234567", "1000000"]) {
        const saved = await activity.record(user.id, payment({ amount: { amount, asset: "USDC" } }));
        assert.equal(saved.amount.amount, amount);
        assert.equal(typeof saved.amount.amount, "string");
      }
    });

    it("refuses a negative payment", async () => {
      const activity = new PostgresActivityStore(db.pool);
      const user = await someone(db.pool);
      await assert.rejects(
        () => activity.record(user.id, payment({ amount: { amount: "-5", asset: "USDC" } })),
        (error: unknown) => (error as { code?: string }).code === "23514",
      );
    });

    it("refuses a kind or a status nobody can render", async () => {
      const activity = new PostgresActivityStore(db.pool);
      const user = await someone(db.pool);
      const bad = (error: unknown) => (error as { code?: string }).code === "23514";

      await assert.rejects(() => activity.record(user.id, payment({ kind: "vibes" })), bad);
      await assert.rejects(() => activity.record(user.id, payment({ status: "maybe" })), bad);
    });

    it("moves a waiting payment on when it lands", async () => {
      const activity = new PostgresActivityStore(db.pool);
      const user = await someone(db.pool);
      const sent = await activity.record(user.id, payment({ claimRef: "42" }));

      const settled = await activity.settle(user.id, sent.id, "confirmed", "tx-abc");
      assert.equal(settled.status, "confirmed");
      assert.equal(settled.ref, "tx-abc");
      assert.equal(settled.id, sent.id);
    });

    it("will not let one person settle another's entry", async () => {
      const activity = new PostgresActivityStore(db.pool);
      const owner = await someone(db.pool);
      const stranger = await someone(db.pool);
      const entry = await activity.record(owner.id, payment());

      await assert.rejects(
        () => activity.settle(stranger.id, entry.id, "confirmed"),
        ActivityNotFoundError,
      );
      assert.equal((await activity.list(owner.id))[0]?.status, "pending");
    });

    it("finds a waiting payment by the escrow's id, but only the owner's", async () => {
      const activity = new PostgresActivityStore(db.pool);
      const owner = await someone(db.pool);
      const stranger = await someone(db.pool);
      const claimRef = `claim-${randomUUID()}`;
      await activity.record(owner.id, payment({ claimRef }));

      assert.equal((await activity.findByClaimRef(owner.id, claimRef))?.claimRef, claimRef);
      assert.equal(await activity.findByClaimRef(stranger.id, claimRef), null);
    });

    it("never re-marks money that already went home as delivered", async () => {
      // A payment nobody claimed comes back to its sender. If a late release
      // could flip it to confirmed, the feed would tell them it arrived after
      // they already have it back.
      const activity = new PostgresActivityStore(db.pool);
      const user = await someone(db.pool);
      const claimRef = `claim-${randomUUID()}`;
      const sent = await activity.record(user.id, payment({ claimRef }));

      await activity.settle(user.id, sent.id, "returned", "tx-refund");
      await activity.settleByClaimRef(claimRef, "confirmed", "tx-late");

      const after = (await activity.list(user.id))[0];
      assert.equal(after?.status, "returned");
      assert.equal(after?.ref, "tx-refund");
    });

    it("lets only one of two racing servers settle a claim", async () => {
      const activity = new PostgresActivityStore(db.pool);
      const user = await someone(db.pool);
      const claimRef = `claim-${randomUUID()}`;
      await activity.record(user.id, payment({ claimRef }));

      await Promise.all([
        activity.settleByClaimRef(claimRef, "confirmed", "tx-one"),
        activity.settleByClaimRef(claimRef, "confirmed", "tx-two"),
      ]);

      const refs = (await activity.list(user.id)).map((entry) => entry.ref);
      assert.equal(refs.length, 1);
      assert.ok(refs[0] === "tx-one" || refs[0] === "tx-two", `unexpected ref ${refs[0]}`);
    });

    it("hands back only as much history as it was asked for", async () => {
      const activity = new PostgresActivityStore(db.pool);
      const user = await someone(db.pool);
      for (let n = 0; n < 5; n++) await activity.record(user.id, payment());

      assert.equal((await activity.list(user.id, { limit: 2 })).length, 2);
      assert.equal((await activity.list(user.id)).length, 5);
    });
  });

  describe("asking someone for money", () => {
    const asking = (fromUserId: string, to = "bo") => ({
      fromUserId,
      fromHandle: { platform: "x", username: "amaka" } as const,
      toHandle: { platform: "x", username: to } as const,
      amount: { amount: "12.50", asset: "USDC" },
      note: "for the taxi",
    });

    it("survives the wait it exists for", async () => {
      const requests = new PostgresRequestStore(db.pool);
      const user = await someone(db.pool);
      const made = await requests.create(asking(user.id));

      const read = await requests.get(made.id);
      assert.deepEqual(read, made);
      assert.equal(read?.status, "pending");
      assert.equal(read?.amount.amount, "12.50");
      assert.equal(read?.note, "for the taxi");
      assert.equal("settledAt" in read!, false);
    });

    it("waits for a handle whatever case it is asked about", async () => {
      const requests = new PostgresRequestStore(db.pool);
      const user = await someone(db.pool);
      const to = `bo${randomBytes(4).toString("hex")}`;
      const made = await requests.create(asking(user.id, to));

      const waiting = await requests.addressedTo([{ platform: "x", username: to.toUpperCase() }]);
      assert.deepEqual(waiting.map((r) => r.id), [made.id]);
    });

    it("collects what is waiting across every handle somebody owns", async () => {
      const requests = new PostgresRequestStore(db.pool);
      const user = await someone(db.pool);
      const onX = `x${randomBytes(4).toString("hex")}`;
      const onTelegram = `tg${randomBytes(4).toString("hex")}`;

      const a = await requests.create({ ...asking(user.id), toHandle: { platform: "x", username: onX } });
      const b = await requests.create({
        ...asking(user.id),
        toHandle: { platform: "telegram", username: onTelegram },
      });

      const waiting = await requests.addressedTo([
        { platform: "x", username: onX },
        { platform: "telegram", username: onTelegram },
      ]);
      assert.deepEqual(new Set(waiting.map((r) => r.id)), new Set([a.id, b.id]));
      assert.deepEqual(await requests.addressedTo([]), []);
    });

    it("does not confuse the same name on two platforms", async () => {
      const requests = new PostgresRequestStore(db.pool);
      const user = await someone(db.pool);
      const name = `same${randomBytes(4).toString("hex")}`;
      const onX = await requests.create({ ...asking(user.id), toHandle: { platform: "x", username: name } });
      await requests.create({ ...asking(user.id), toHandle: { platform: "telegram", username: name } });

      const waiting = await requests.addressedTo([{ platform: "x", username: name }]);
      assert.deepEqual(waiting.map((r) => r.id), [onX.id]);
    });

    it("lists what one person asked for, newest first", async () => {
      const requests = new PostgresRequestStore(db.pool);
      const mine = await someone(db.pool);
      const theirs = await someone(db.pool);
      const first = await requests.create(asking(mine.id, "one"));
      const second = await requests.create(asking(mine.id, "two"));
      await requests.create(asking(theirs.id, "three"));

      assert.deepEqual((await requests.sentBy(mine.id)).map((r) => r.id), [second.id, first.id]);
    });

    it("records when it was settled, because a screen has to say", async () => {
      const requests = new PostgresRequestStore(db.pool);
      const user = await someone(db.pool);
      const made = await requests.create(asking(user.id));

      const paid = await requests.settle(made.id, "paid", "tx-xyz");
      assert.equal(paid.status, "paid");
      assert.equal(paid.ref, "tx-xyz");
      assert.ok(paid.settledAt, "a settled request has to carry a time");
    });

    it("answers a second settle instead of reporting a payment that worked as failed", async () => {
      // The caller reaches this line just after moving real money. Throwing
      // here would tell somebody their payment failed when it did not.
      const requests = new PostgresRequestStore(db.pool);
      const user = await someone(db.pool);
      const made = await requests.create(asking(user.id));

      const first = await requests.settle(made.id, "paid", "tx-first");
      const again = await requests.settle(made.id, "cancelled", "tx-second");

      assert.equal(again.status, "paid");
      assert.equal(again.ref, "tx-first");
      assert.equal(first.settledAt, again.settledAt);
    });

    it("lets only one of two people racing to pay it through", async () => {
      const requests = new PostgresRequestStore(db.pool);
      const user = await someone(db.pool);
      const made = await requests.create(asking(user.id));

      const [a, b] = await Promise.all([
        requests.settle(made.id, "paid", "tx-a"),
        requests.settle(made.id, "paid", "tx-b"),
      ]);

      assert.equal(a.ref, b.ref);
      assert.equal((await requests.get(made.id))?.ref, a.ref);
    });

    it("refuses a settled request with no time on it", async () => {
      const requests = new PostgresRequestStore(db.pool);
      const user = await someone(db.pool);
      const made = await requests.create(asking(user.id));

      await assert.rejects(
        () => db.pool.query("update money_requests set status = 'paid' where id = $1", [made.id]),
        (error: unknown) => (error as { code?: string }).code === "23514",
      );
    });

    it("refuses to ask for nothing", async () => {
      const requests = new PostgresRequestStore(db.pool);
      const user = await someone(db.pool);
      await assert.rejects(
        () => requests.create({ ...asking(user.id), amount: { amount: "0", asset: "USDC" } }),
        (error: unknown) => (error as { code?: string }).code === "23514",
      );
    });
  });

  describe("making a payment safe to call twice", () => {
    const FINGERPRINT = "send:5:USDC:@bo";

    it("claims a key, holds it while the work runs, then answers with the result", async () => {
      const store = new PostgresIdempotencyStore(db.pool);
      const user = randomUUID();
      const key = randomUUID();

      assert.deepEqual(await store.begin(user, key, FINGERPRINT), { kind: "fresh" });
      assert.deepEqual(await store.begin(user, key, FINGERPRINT), { kind: "in-flight" });

      await store.complete(user, key, { status: 200, body: { ref: "tx-1" } });

      assert.deepEqual(await store.begin(user, key, FINGERPRINT), {
        kind: "done",
        record: { status: 200, body: { ref: "tx-1" } },
      });
    });

    it("lets exactly one of many simultaneous requests do the work", async () => {
      // The failure this table exists for. Eight retries arriving at once, on
      // eight different connections, the way they would across a load balancer.
      // Seven of them must be told to wait rather than sending the money again.
      const store = new PostgresIdempotencyStore(db.pool);
      const user = randomUUID();
      const key = randomUUID();

      const states = await Promise.all(
        Array.from({ length: 8 }, () => store.begin(user, key, FINGERPRINT)),
      );

      const fresh = states.filter((state) => state.kind === "fresh");
      assert.equal(fresh.length, 1, `${fresh.length} requests would each have sent the money`);
      assert.equal(states.filter((state) => state.kind === "in-flight").length, 7);
    });

    it("keeps one person's keys away from another's", async () => {
      const store = new PostgresIdempotencyStore(db.pool);
      const key = "same-key";
      const mine = randomUUID();
      const theirs = randomUUID();

      assert.deepEqual(await store.begin(mine, key, FINGERPRINT), { kind: "fresh" });
      assert.deepEqual(await store.begin(theirs, key, FINGERPRINT), { kind: "fresh" });
    });

    it("refuses to answer a different payment with an earlier one's receipt", async () => {
      const store = new PostgresIdempotencyStore(db.pool);
      const user = randomUUID();
      const key = randomUUID();

      await store.begin(user, key, FINGERPRINT);
      assert.deepEqual(await store.begin(user, key, "send:500:USDC:@stranger"), { kind: "mismatch" });
    });

    it("still refuses after the first one has finished", async () => {
      // completing must not overwrite what the key was claimed for. If it did,
      // a different payment reusing the key would come back as an ordinary
      // replay, and somebody would be told their money moved when it did not.
      const store = new PostgresIdempotencyStore(db.pool);
      const user = randomUUID();
      const key = randomUUID();

      await store.begin(user, key, FINGERPRINT);
      await store.complete(user, key, { status: 200, body: { ref: "tx-1" } });

      assert.deepEqual(await store.begin(user, key, "send:500:USDC:@stranger"), { kind: "mismatch" });
    });

    it("gives the key back when the work failed, so a retry is a real retry", async () => {
      const store = new PostgresIdempotencyStore(db.pool);
      const user = randomUUID();
      const key = randomUUID();

      await store.begin(user, key, FINGERPRINT);
      await store.release(user, key);

      assert.deepEqual(await store.begin(user, key, FINGERPRINT), { kind: "fresh" });
    });

    it("carries a null body through without losing it", async () => {
      const store = new PostgresIdempotencyStore(db.pool);
      const user = randomUUID();
      const key = randomUUID();

      await store.begin(user, key, FINGERPRINT);
      await store.complete(user, key, { status: 204, body: null });

      assert.deepEqual(await store.begin(user, key, FINGERPRINT), {
        kind: "done",
        record: { status: 204, body: null },
      });
    });

    it("drops what nobody can still be retrying, and nothing else", async () => {
      const store = new PostgresIdempotencyStore(db.pool);
      const user = randomUUID();
      const old = randomUUID();
      const recent = randomUUID();

      await store.begin(user, old, FINGERPRINT);
      await store.begin(user, recent, FINGERPRINT);
      await db.pool.query(
        "update idempotency set claimed_at = now() - interval '25 hours' where user_id = $1 and key = $2",
        [user, old],
      );

      assert.ok((await store.sweep()) >= 1);
      assert.deepEqual(await store.begin(user, recent, FINGERPRINT), { kind: "in-flight" });
    });

    it("lets a key be reused once it is old enough to be nobody's retry", async () => {
      const store = new PostgresIdempotencyStore(db.pool);
      const user = randomUUID();
      const key = randomUUID();

      await store.begin(user, key, FINGERPRINT);
      await db.pool.query(
        "update idempotency set claimed_at = now() - interval '25 hours' where user_id = $1 and key = $2",
        [user, key],
      );

      assert.deepEqual(await store.begin(user, key, "something:else"), { kind: "fresh" });
    });
  });

  describe("account keys", () => {
    const seal = () => Seal.fromEnv(`1:${randomBytes(32).toString("base64")}`);

    it("can sign for an account it made, after being asked for it again", async () => {
      const signers = new PostgresSigners(db.pool, seal());
      const made = await signers.create();

      const again = await signers.forAddress(made.address);
      assert.ok(again, "the key it just wrote down could not be read back");
      assert.equal(again.address, made.address);
    });

    it("does not write the key down where a dump would carry it", async () => {
      const signers = new PostgresSigners(db.pool, seal());
      const made = await signers.create();

      const { rows } = await db.pool.query<{ ciphertext: Buffer; iv: Buffer; auth_tag: Buffer }>(
        "select ciphertext, iv, auth_tag from wallet_keys where address = $1",
        [made.address],
      );
      const stored = rows[0]!.ciphertext.toString("utf8");
      assert.equal(/^S[A-Z2-7]{55}$/.test(stored), false, "the secret is readable in the table");
      assert.equal(rows[0]!.iv.length, 12);
      assert.equal(rows[0]!.auth_tag.length, 16);
    });

    it("cannot be opened by a server holding the database but not the key", async () => {
      const signers = new PostgresSigners(db.pool, seal());
      const made = await signers.create();

      const impostor = new PostgresSigners(db.pool, seal());
      await assert.rejects(() => impostor.forAddress(made.address), /does not check out/);
    });

    it("cannot have one account's key moved onto another's row", async () => {
      // The address is authenticated alongside the ciphertext. Swapping the
      // rows would otherwise hand one person's key to somebody else's wallet.
      const key = seal();
      const signers = new PostgresSigners(db.pool, key);
      const mine = await signers.create();
      const theirs = await signers.create();

      await db.pool.query(
        `update wallet_keys set ciphertext = mine.ciphertext, iv = mine.iv, auth_tag = mine.auth_tag
         from (select ciphertext, iv, auth_tag from wallet_keys where address = $1) as mine
         where wallet_keys.address = $2`,
        [mine.address, theirs.address],
      );

      await assert.rejects(() => signers.forAddress(theirs.address), /does not check out/);
    });

    it("has no key for an address it never made", async () => {
      const signers = new PostgresSigners(db.pool, seal());
      assert.equal(await signers.forAddress(address()), null);
    });

    it("answers for Selkie's own accounts without ever storing them", async () => {
      const signers = new PostgresSigners(db.pool, seal());
      const held = await signers.count();
      const house = await new PostgresSigners(db.pool, seal()).create();

      const withHouse = new PostgresSigners(db.pool, seal(), [house]);
      assert.equal((await withHouse.forAddress(house.address))?.address, house.address);
      assert.equal(await signers.count(), held + 1);
    });

    it("counts what it holds", async () => {
      const signers = new PostgresSigners(db.pool, seal());
      const before = await signers.count();
      await signers.create();
      await signers.create();
      assert.equal(await signers.count(), before + 2);
    });
  });

  describe("after a restart", () => {
    it("knows everything it knew before, from a connection that has never seen it", async () => {
      // The whole point. Nothing below is in this process's memory: it is read
      // back out of Postgres by objects built after the ones that wrote it were
      // thrown away, which is what a deploy does to a running server.
      const key = Seal.fromEnv(`1:${randomBytes(32).toString("base64")}`);
      const identity = login({ username: `restart${randomBytes(4).toString("hex")}` });

      const signer = await new PostgresSigners(db.pool, key).create();
      const before = await new PostgresUserStore(db.pool).create({
        address: signer.address,
        identities: [identity],
      });
      await new PostgresAccountDirectory(db.pool).save({
        handle: { platform: "x", username: identity.username! },
        address: signer.address,
        provisioned: true,
      });
      const entry = await new PostgresActivityStore(db.pool).record(before.id, {
        kind: "send",
        chain: "stellar",
        amount: { amount: "7.25", asset: "USDC" },
        status: "confirmed",
        counterparty: "@bo",
      });

      // Everything above is now unreachable. Build the world again.
      const users = new PostgresUserStore(db.pool);
      const after = await users.findByHandle("x", identity.username!);
      assert.equal(after?.id, before.id, "the same person, not a new empty account");
      assert.equal(after?.address, before.address, "the same wallet address");

      const directory = new PostgresAccountDirectory(db.pool);
      assert.equal((await directory.lookup({ platform: "x", username: identity.username! }))?.provisioned, true);

      const feed = await new PostgresActivityStore(db.pool).list(before.id);
      assert.equal(feed[0]?.id, entry.id);
      assert.equal(feed[0]?.amount.amount, "7.25");

      const signers = new PostgresSigners(db.pool, key);
      assert.equal((await signers.forAddress(before.address))?.address, before.address);
    });
  });
});
