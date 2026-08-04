import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { HandleRef } from "@selkie/core";
import {
  InMemoryCursorStore,
  InMemoryHandleIndex,
  SqliteCursorStore,
  SqliteHandleIndex,
  handleHashHex,
} from "./index-store";
import { ClaimWatcher, type DepositBatch } from "./watcher";
import { openDb } from "../db/open";

const AMAKA: HandleRef = { platform: "x", username: "amaka" };
const CHIDI: HandleRef = { platform: "telegram", username: "chidi" };

/** Deposits the chain reports, queued by the test one batch at a time. */
class Events {
  batches: DepositBatch[] = [];
  seenCursors: (string | null)[] = [];

  async depositsSince(cursor: string | null): Promise<DepositBatch> {
    this.seenCursors.push(cursor);
    return this.batches.shift() ?? { handleHashes: [], cursor: cursor ?? "start" };
  }
}

describe("claim watcher", () => {
  let events: Events;
  let index: InMemoryHandleIndex;
  let cursors: InMemoryCursorStore;
  let owners: Map<string, { id: string }>;
  let collected: string[];

  const build = () =>
    new ClaimWatcher({
      events,
      index,
      cursors,
      async ownerOf(handle) {
        return owners.get(`${handle.platform}:${handle.username}`) ?? null;
      },
      async collect(user) {
        collected.push(user.id);
      },
    });

  beforeEach(async () => {
    events = new Events();
    index = new InMemoryHandleIndex();
    cursors = new InMemoryCursorStore();
    owners = new Map();
    collected = [];
    await index.remember(AMAKA);
    await index.remember(CHIDI);
  });

  test("money arriving for someone who is already here gets collected", async () => {
    owners.set("x:amaka", { id: "user-amaka" });
    events.batches = [{ handleHashes: [await handleHashHex(AMAKA)], cursor: "c1" }];

    assert.equal(await build().tick(), 1);
    assert.deepEqual(collected, ["user-amaka"]);
  });

  /**
   * The whole product. Money addressed to somebody who has never heard of
   * Selkie must stay exactly where it is until they prove the handle is theirs,
   * and their sign-in is what collects it.
   */
  test("money for a handle nobody has claimed is left alone", async () => {
    events.batches = [{ handleHashes: [await handleHashHex(AMAKA)], cursor: "c1" }];

    assert.equal(await build().tick(), 0);
    assert.deepEqual(collected, []);
  });

  test("a hash we do not recognise is not our business", async () => {
    owners.set("x:amaka", { id: "user-amaka" });
    events.batches = [{ handleHashes: ["ff".repeat(32)], cursor: "c1" }];

    assert.equal(await build().tick(), 0);
    assert.deepEqual(collected, []);
  });

  test("three deposits for one person is one collection", async () => {
    owners.set("x:amaka", { id: "user-amaka" });
    const hash = await handleHashHex(AMAKA);
    events.batches = [{ handleHashes: [hash, hash, hash], cursor: "c1" }];

    await build().tick();
    // Collecting releases everything waiting for that handle in one call, so
    // doing it three times would be two wasted transactions.
    assert.deepEqual(collected, ["user-amaka"]);
  });

  test("two people in one batch both get theirs", async () => {
    owners.set("x:amaka", { id: "user-amaka" });
    owners.set("telegram:chidi", { id: "user-chidi" });
    events.batches = [
      { handleHashes: [await handleHashHex(AMAKA), await handleHashHex(CHIDI)], cursor: "c1" },
    ];

    assert.equal(await build().tick(), 2);
    assert.deepEqual(collected.sort(), ["user-amaka", "user-chidi"]);
  });

  test("it resumes where it left off instead of starting over", async () => {
    owners.set("x:amaka", { id: "user-amaka" });
    events.batches = [
      { handleHashes: [await handleHashHex(AMAKA)], cursor: "c1" },
      { handleHashes: [], cursor: "c2" },
    ];

    const watcher = build();
    await watcher.tick();
    await watcher.tick();

    assert.deepEqual(events.seenCursors, [null, "c1"]);
    assert.equal(await cursors.get("escrow-deposits"), "c2");
  });

  /**
   * A crash halfway through a batch has to replay it. Losing the cursor is
   * cheap — collecting twice finds nothing waiting the second time — but
   * advancing past deposits we never handled loses somebody's money until their
   * next sign-in.
   */
  test("a failed batch does not advance the cursor", async () => {
    owners.set("x:amaka", { id: "user-amaka" });
    events.batches = [{ handleHashes: [await handleHashHex(AMAKA)], cursor: "c1" }];

    const watcher = new ClaimWatcher({
      events,
      index,
      cursors,
      async ownerOf() {
        return { id: "user-amaka" };
      },
      async collect() {
        throw new Error("chain is having a moment");
      },
    });

    await assert.rejects(() => watcher.tick());
    assert.equal(await cursors.get("escrow-deposits"), null);
  });

  test("one bad poll does not stop the watcher for good", async () => {
    const errors: unknown[] = [];
    const watcher = new ClaimWatcher({
      events: {
        async depositsSince() {
          throw new Error("rpc down");
        },
      },
      index,
      cursors,
      async ownerOf() {
        return null;
      },
      async collect() {},
      onError: (error) => errors.push(error),
    });

    watcher.start(1);
    await new Promise((resolve) => setTimeout(resolve, 25));
    watcher.stop();

    assert.ok(errors.length > 0, "it should report rather than die silently");
  });

  test("the handle index survives a restart", async () => {
    const db = openDb(":memory:");
    const stored = new SqliteHandleIndex(db);
    await stored.remember(AMAKA);

    const found = await stored.find(await handleHashHex(AMAKA));
    assert.deepEqual(found, AMAKA);
    // Case does not matter: the RPC and the contract may disagree about it.
    assert.deepEqual(await stored.find((await handleHashHex(AMAKA)).toUpperCase()), AMAKA);

    const cursor = new SqliteCursorStore(db);
    assert.equal(await cursor.get("escrow-deposits"), null);
    await cursor.set("escrow-deposits", "c9");
    await cursor.set("escrow-deposits", "c10");
    assert.equal(await cursor.get("escrow-deposits"), "c10");
    db.close();
  });

  test("@amaka on X and @amaka on telegram hash to different people", async () => {
    const onX = await handleHashHex({ platform: "x", username: "amaka" });
    const onTelegram = await handleHashHex({ platform: "telegram", username: "amaka" });
    assert.notEqual(onX, onTelegram);
  });
});
