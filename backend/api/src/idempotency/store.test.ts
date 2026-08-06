import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryIdempotencyStore } from "./store";

const ALICE = "user-a";
const BOB = "user-b";
const PAY_BO_5 = "pay:bo:5";
const PAY_BO_9 = "pay:bo:9";

describe("claiming a key", () => {
  it("lets the first request through", async () => {
    const store = new InMemoryIdempotencyStore();
    assert.deepEqual(await store.begin(ALICE, "k1", PAY_BO_5), { kind: "fresh" });
  });

  it("holds the key while the work is running, so a retry does not race it", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.begin(ALICE, "k1", PAY_BO_5);

    assert.deepEqual(await store.begin(ALICE, "k1", PAY_BO_5), { kind: "in-flight" });
  });

  it("gives back the first answer once the work is done", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.begin(ALICE, "k1", PAY_BO_5);
    await store.complete(ALICE, "k1", { status: 200, body: { ref: "first" } });

    const state = await store.begin(ALICE, "k1", PAY_BO_5);
    assert.equal(state.kind, "done");
    assert.deepEqual(state.kind === "done" ? state.record.body : null, { ref: "first" });
  });

  it("lets go of a key whose work failed, so the genuine retry can happen", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.begin(ALICE, "k1", PAY_BO_5);
    await store.release(ALICE, "k1");

    assert.deepEqual(await store.begin(ALICE, "k1", PAY_BO_5), { kind: "fresh" });
  });

  it("keeps one person's keys away from another's", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.begin(ALICE, "k1", PAY_BO_5);

    assert.deepEqual(await store.begin(BOB, "k1", PAY_BO_5), { kind: "fresh" });
  });
});

describe("the same key asking for something else", () => {
  it("refuses rather than answering, before the work has finished", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.begin(ALICE, "k1", PAY_BO_5);

    assert.deepEqual(await store.begin(ALICE, "k1", PAY_BO_9), { kind: "mismatch" });
  });

  it("refuses rather than handing back the first payment's receipt", async () => {
    // The failure this exists to prevent. Answering a different payment with
    // the first one's "sent" tells somebody their money moved when it did not,
    // which is the one thing a payments API must never say.
    const store = new InMemoryIdempotencyStore();
    await store.begin(ALICE, "k1", PAY_BO_5);
    await store.complete(ALICE, "k1", { status: 200, body: { ref: "first" } });

    assert.deepEqual(await store.begin(ALICE, "k1", PAY_BO_9), { kind: "mismatch" });
  });

  it("still recognises the identical request as a replay", async () => {
    const store = new InMemoryIdempotencyStore();
    await store.begin(ALICE, "k1", PAY_BO_5);
    await store.complete(ALICE, "k1", { status: 200, body: { ref: "first" } });

    assert.equal((await store.begin(ALICE, "k1", PAY_BO_5)).kind, "done");
  });

  it("remembers what it was claimed for across completion", async () => {
    // Losing the fingerprint when the record is written would let the next
    // different request through as an ordinary replay, which is the whole bug
    // with one extra step.
    const store = new InMemoryIdempotencyStore();
    await store.begin(ALICE, "k1", PAY_BO_5);
    await store.complete(ALICE, "k1", { status: 200, body: {} });
    await store.complete(ALICE, "k1", { status: 200, body: {} });

    assert.deepEqual(await store.begin(ALICE, "k1", PAY_BO_9), { kind: "mismatch" });
  });
});
