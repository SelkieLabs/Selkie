import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { SqliteActivityStore } from "../activity/sqlite-store";
import { SqliteAccountDirectory } from "./directory";
import { openDb } from "./open";
import { SqliteUserStore } from "../identity/sqlite-store";
import { SqliteIdempotencyStore } from "../idempotency/sqlite-store";
import { SqliteRequestStore } from "../requests/sqlite-store";

/**
 * The whole point of a database: close it, open it again, and everything is
 * still there.
 *
 * These use a real file rather than `:memory:`, because a store that only works
 * while the process is alive is what we are replacing. Restarting the API used
 * to lose every account and strand every wallet, and nothing short of reopening
 * the file proves that is fixed.
 */
describe("persistence", () => {
  let dir: string;
  let path: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "selkie-db-"));
    path = join(dir, "selkie.db");
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  test("a user and their identities survive a restart", async () => {
    const first = openDb(path);
    const created = await new SqliteUserStore(first).create({
      address: "GADDRESS",
      identities: [
        {
          provider: "x",
          subject: "x1",
          username: "chidi",
          displayName: "Chidi",
          linkedAt: new Date().toISOString(),
        },
      ],
    });
    first.close();

    const second = openDb(path);
    const users = new SqliteUserStore(second);

    const byId = await users.get(created.id);
    assert.equal(byId?.address, "GADDRESS");
    assert.equal(byId?.identities.length, 1);

    // Both lookups the sign-in path uses, on a database it did not write.
    assert.equal((await users.findByIdentity("x", "x1"))?.id, created.id);
    assert.equal((await users.findByHandle("x", "CHIDI"))?.id, created.id);
    second.close();
  });

  /**
   * The address is where a handle's money already is. A handle that came back
   * mapped to a different address is a person whose balance vanished.
   */
  test("which handle owns which address survives a restart", async () => {
    const first = openDb(path);
    await new SqliteAccountDirectory(first).save({
      handle: { platform: "telegram", username: "amaka" },
      address: "GAMAKA",
      provisioned: false,
    });
    first.close();

    const second = openDb(path);
    const directory = new SqliteAccountDirectory(second);

    const found = await directory.lookup({ platform: "telegram", username: "amaka" });
    assert.equal(found?.address, "GAMAKA");
    assert.equal(found?.provisioned, false);
    assert.equal((await directory.lookupByAddress("GAMAKA"))?.handle.username, "amaka");

    // Provisioning flips a flag; it must never move the address.
    await directory.save({
      handle: { platform: "telegram", username: "amaka" },
      address: "GAMAKA",
      provisioned: true,
    });
    const after = await directory.lookup({ platform: "telegram", username: "amaka" });
    assert.equal(after?.provisioned, true);
    assert.equal(after?.address, "GAMAKA");
    second.close();
  });

  test("waiting money is still refundable after a restart", async () => {
    const first = openDb(path);
    await new SqliteActivityStore(first).record("user-1", {
      kind: "send",
      chain: "stellar",
      amount: { amount: "5.25", asset: "USDC" },
      counterparty: "@amaka",
      counterpartyHandle: { platform: "x", username: "amaka" },
      status: "pending",
      claimRef: "42",
      refundableAt: "2026-01-01T00:00:00.000Z",
    });
    first.close();

    const second = openDb(path);
    const activity = new SqliteActivityStore(second);

    const entry = await activity.findByClaimRef("user-1", "42");
    assert.ok(entry, "the id needed to take money back must outlive the process");
    // Money as a string, all the way through. A float here is how you end up
    // owing somebody 5.249999999.
    assert.equal(entry.amount.amount, "5.25");
    assert.deepEqual(entry.counterpartyHandle, { platform: "x", username: "amaka" });
    assert.equal(entry.refundableAt, "2026-01-01T00:00:00.000Z");

    // And it is not visible to anybody else.
    assert.equal(await activity.findByClaimRef("user-2", "42"), null);
    second.close();
  });

  test("a request still waits for its handle after a restart", async () => {
    const first = openDb(path);
    const created = await new SqliteRequestStore(first).create({
      fromUserId: "user-1",
      fromHandle: { platform: "x", username: "chidi" },
      toHandle: { platform: "x", username: "amaka" },
      amount: { amount: "20", asset: "USDC" },
      note: "lunch",
    });
    first.close();

    const second = openDb(path);
    const requests = new SqliteRequestStore(second);

    const waiting = await requests.addressedTo([{ platform: "x", username: "amaka" }]);
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0]?.id, created.id);
    assert.equal(waiting[0]?.note, "lunch");

    // Not waiting for the same name on the other platform. Different person.
    assert.deepEqual(await requests.addressedTo([{ platform: "telegram", username: "amaka" }]), []);
    second.close();
  });

  /**
   * A restart between a payment and its retry is exactly the kind of thing that
   * happens right after a request took suspiciously long. If the key does not
   * survive, the retry sends the money again.
   */
  test("an answer already given survives a restart", async () => {
    const first = openDb(path);
    const before = new SqliteIdempotencyStore(first);
    assert.equal((await before.begin("user-1", "key-1")).kind, "fresh");
    await before.complete("user-1", "key-1", { status: 200, body: { message: "Sent." } });
    first.close();

    const second = openDb(path);
    const state = await new SqliteIdempotencyStore(second).begin("user-1", "key-1");
    assert.equal(state.kind, "done");
    assert.deepEqual(state.kind === "done" && state.record.body, { message: "Sent." });
    second.close();
  });

  test("a key claimed but never finished reads as in flight, not as done", async () => {
    const db = openDb(":memory:");
    const store = new SqliteIdempotencyStore(db);

    assert.equal((await store.begin("user-1", "k")).kind, "fresh");
    assert.equal((await store.begin("user-1", "k")).kind, "in-flight");

    // Work that failed lets the key go, so a genuine retry can happen.
    await store.release("user-1", "k");
    assert.equal((await store.begin("user-1", "k")).kind, "fresh");
    db.close();
  });

  test("opening an existing database is not a fresh start", async () => {
    const first = openDb(path);
    const users = new SqliteUserStore(first);
    const created = await users.create({ address: "GKEEP", identities: [] });
    first.close();

    // The schema is applied on every boot. It must be a no-op on a database
    // that already has rows in it.
    const second = openDb(path);
    assert.equal((await new SqliteUserStore(second).get(created.id))?.address, "GKEEP");
    second.close();
  });
});
