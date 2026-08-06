import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryAccountDirectory } from "@selkie/chain-stellar";
import { MemoryKeep } from "@selkie/core";
import { InMemoryActivityStore } from "./activity/store";
import { InMemoryUserStore } from "./identity/store";
import { InMemoryIdempotencyStore } from "./idempotency/store";
import { InMemoryRequestStore } from "./requests/store";

/**
 * What has to still be true after the server is restarted.
 *
 * Every test here does the same thing: use a store, throw it away, build a new
 * one over the same Keep, and check the second one knows what the first one
 * did. That is a deploy, and until now every one of them signed every user out
 * into a new empty wallet while their money stayed in the old one.
 */

const AMAKA = { platform: "x" as const, username: "amaka" };
const LINKED_AT = "2026-08-06T10:00:00.000Z";

function user() {
  return {
    address: "GAMAKA",
    identities: [
      {
        provider: "x" as const,
        attestation: "login" as const,
        subject: "111",
        username: "amaka",
        linkedAt: LINKED_AT,
      },
    ],
  };
}

describe("people, after a restart", () => {
  it("are recognised as themselves rather than signed up again", async () => {
    const keep = new MemoryKeep();
    const before = await new InMemoryUserStore(keep).create(user());

    const after = await new InMemoryUserStore(keep).findByIdentity("x", "111");
    assert.equal(after?.id, before.id, "a new id here means a second, empty wallet");
    assert.equal(after?.address, "GAMAKA");
  });

  it("can still be found by handle, which is how money reaches them", async () => {
    const keep = new MemoryKeep();
    await new InMemoryUserStore(keep).create(user());

    assert.ok(await new InMemoryUserStore(keep).findByHandle("x", "AMAKA"));
  });

  it("keep the accounts they linked afterwards", async () => {
    const keep = new MemoryKeep();
    const first = new InMemoryUserStore(keep);
    const created = await first.create(user());
    await first.addIdentity(created.id, {
      provider: "telegram",
      attestation: "login",
      subject: "tg-9",
      username: "ama",
      linkedAt: LINKED_AT,
    });

    const found = await new InMemoryUserStore(keep).findByIdentity("telegram", "tg-9");
    assert.equal(found?.id, created.id);
  });

  it("stay deleted", async () => {
    const keep = new MemoryKeep();
    const first = new InMemoryUserStore(keep);
    const created = await first.create(user());
    await first.delete(created.id);

    assert.equal(await new InMemoryUserStore(keep).get(created.id), null);
  });

  it("do not lose an identity they unlinked", async () => {
    const keep = new MemoryKeep();
    const first = new InMemoryUserStore(keep);
    const created = await first.create(user());
    await first.removeIdentity(created.id, "x", "111");

    assert.equal(await new InMemoryUserStore(keep).findByIdentity("x", "111"), null);
  });
});

describe("wallets, after a restart", () => {
  it("still belong to the handle they were made for", async () => {
    // The directory is the only thing joining a handle to an account. Lose it
    // and the money is on the ledger, untouched, and unreachable.
    const keep = new MemoryKeep();
    await new InMemoryAccountDirectory(keep).save({
      handle: AMAKA,
      address: "GAMAKA",
      provisioned: true,
    });

    const found = await new InMemoryAccountDirectory(keep).lookup(AMAKA);
    assert.equal(found?.address, "GAMAKA");
    assert.equal(found?.provisioned, true, "or we would try to set the account up a second time");
  });

  it("can still be traced back from an address, which is how a claim finds its owner", async () => {
    const keep = new MemoryKeep();
    await new InMemoryAccountDirectory(keep).save({
      handle: AMAKA,
      address: "GAMAKA",
      provisioned: true,
    });

    assert.deepEqual((await new InMemoryAccountDirectory(keep).lookupByAddress("GAMAKA"))?.handle, AMAKA);
  });
});

describe("history, after a restart", () => {
  const payment = {
    kind: "send" as const,
    chain: "stellar" as const,
    counterparty: "@bo",
    amount: { asset: "USDC", amount: "5" },
    status: "confirmed" as const,
  };

  it("is still there", async () => {
    const keep = new MemoryKeep();
    await new InMemoryActivityStore(keep).record("u1", payment);

    assert.equal((await new InMemoryActivityStore(keep).list("u1")).length, 1);
  });

  it("does not hand a second entry the id the first one is using", async () => {
    // Ids number from a counter. Restarting it would give two rows the same id,
    // and settling one by id would then reach into the wrong payment.
    const keep = new MemoryKeep();
    const first = await new InMemoryActivityStore(keep).record("u1", payment);
    const second = await new InMemoryActivityStore(keep).record("u1", payment);

    assert.notEqual(second.id, first.id);
  });

  it("can still settle money that was waiting when the server went down", async () => {
    // The whole point of a waiting payment is that it outlives the moment it
    // was sent. If the restart forgot it, the sender's feed would say pending
    // for ever even after their friend had the money.
    const keep = new MemoryKeep();
    await new InMemoryActivityStore(keep).record("u1", {
      ...payment,
      status: "pending",
      claimRef: "escrow-7",
    });

    const after = new InMemoryActivityStore(keep);
    await after.settleByClaimRef("escrow-7", "confirmed", "tx-abc");

    const [row] = await after.list("u1");
    assert.equal(row?.status, "confirmed");
    assert.equal(row?.ref, "tx-abc");
  });
});

describe("asks for money, after a restart", () => {
  const ask = {
    fromUserId: "u1",
    fromHandle: AMAKA,
    toHandle: { platform: "x" as const, username: "bo" },
    amount: { asset: "USDC", amount: "5" },
  };

  it("are still waiting for the person they were sent to", async () => {
    // A request sits there until its recipient signs in, which can be days.
    const keep = new MemoryKeep();
    await new InMemoryRequestStore(keep).create(ask);

    const waiting = await new InMemoryRequestStore(keep).addressedTo([
      { platform: "x", username: "bo" },
    ]);
    assert.equal(waiting.length, 1);
  });

  it("stay settled once they are paid", async () => {
    const keep = new MemoryKeep();
    const first = new InMemoryRequestStore(keep);
    const created = await first.create(ask);
    await first.settle(created.id, "paid", "tx-1");

    assert.equal((await new InMemoryRequestStore(keep).get(created.id))?.status, "paid");
  });

  it("do not give a second ask the id of the first", async () => {
    const keep = new MemoryKeep();
    const first = await new InMemoryRequestStore(keep).create(ask);
    const second = await new InMemoryRequestStore(keep).create(ask);

    assert.notEqual(second.id, first.id);
  });
});

describe("the double-payment guard, after a restart", () => {
  it("still refuses to do a payment it has already done", async () => {
    // A deploy mid-payment is exactly when a client gives up and retries. A
    // guard that forgot would let that retry through as a second real payment.
    const keep = new MemoryKeep();
    const before = new InMemoryIdempotencyStore(keep);
    await before.begin("u1", "k1", "pay:bo:5");
    await before.complete("u1", "k1", { status: 200, body: { ref: "tx-1" } });

    const state = await new InMemoryIdempotencyStore(keep).begin("u1", "k1", "pay:bo:5");
    assert.equal(state.kind, "done");
    assert.deepEqual(state.kind === "done" ? state.record.body : null, { ref: "tx-1" });
  });

  it("still refuses to answer a different payment with an earlier receipt", async () => {
    const keep = new MemoryKeep();
    const before = new InMemoryIdempotencyStore(keep);
    await before.begin("u1", "k1", "pay:bo:5");
    await before.complete("u1", "k1", { status: 200, body: { ref: "tx-1" } });

    const state = await new InMemoryIdempotencyStore(keep).begin("u1", "k1", "pay:bo:9");
    assert.equal(state.kind, "mismatch");
  });

  it("lets go of a payment that was still running when the process died", async () => {
    // Nothing is running any more. Leaving the key claimed would wedge it for a
    // day, and the person would be told their retry was already in progress by
    // a server that had never finished it.
    const keep = new MemoryKeep();
    await new InMemoryIdempotencyStore(keep).begin("u1", "k1", "pay:bo:5");

    const state = await new InMemoryIdempotencyStore(keep).begin("u1", "k1", "pay:bo:5");
    assert.equal(state.kind, "fresh");
  });
});

describe("without a Keep", () => {
  it("every store behaves exactly as it did before, and writes nothing", async () => {
    const users = new InMemoryUserStore();
    const created = await users.create(user());
    assert.equal((await users.get(created.id))?.address, "GAMAKA");

    const activity = new InMemoryActivityStore();
    await activity.record("u1", {
      kind: "send",
      chain: "stellar",
      counterparty: "@bo",
      amount: { asset: "USDC", amount: "5" },
      status: "confirmed",
    });
    assert.equal((await activity.list("u1")).length, 1);
  });
});
