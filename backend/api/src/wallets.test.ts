import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KeypairSigner } from "@selkie/chain-stellar";
import { MemoryKeep, type Keep } from "@selkie/core";
import { Wallets } from "./wallets";

const HOUSE = KeypairSigner.generate().signer;

describe("the keys to people's accounts", () => {
  it("can still sign after a restart", async () => {
    // The failure this exists to prevent. Before this, a restart threw away the
    // only key to every account Selkie had made, and the money in them stayed
    // on the ledger where everyone could see it and nobody could ever move it.
    const keep = new MemoryKeep();
    const made = await new Wallets(keep).create();

    const signer = await new Wallets(keep).signers.forAddress(made.address);
    assert.ok(signer, `no key for ${made.address} after a restart, so the money in it is gone`);
    assert.equal(signer.address, made.address);
  });

  it("all come back, not just the last one", async () => {
    const keep = new MemoryKeep();
    const first = new Wallets(keep);
    const made = [await first.create(), await first.create(), await first.create()];

    const after = new Wallets(keep);
    for (const wallet of made) {
      assert.ok(await after.signers.forAddress(wallet.address), `lost ${wallet.address}`);
    }
    assert.equal(after.count, 3);
  });

  it("keeps making new accounts after a restart rather than reusing one", async () => {
    const keep = new MemoryKeep();
    const first = await new Wallets(keep).create();
    const second = await new Wallets(keep).create();

    assert.notEqual(second.address, first.address);
    assert.equal(new Wallets(keep).count, 2);
  });

  it("is written down before the address is handed out, not after", async () => {
    // If the process dies between those two lines, the order decides whether
    // the cost is an unused account or somebody's money in an unreachable one.
    const written: string[] = [];
    const watching: Keep = {
      read: () => undefined,
      write: (_shelf, value) => {
        written.push(...(value as string[]));
      },
    };

    const wallet = await new Wallets(watching).create();
    assert.equal(written.length, 1, "the key was not saved before create() returned");
    assert.equal(new KeypairSigner(written[0] ?? "").address, wallet.address);
  });
});

describe("Selkie's own accounts", () => {
  it("can sign, without being written to the file", async () => {
    // The sponsor and oracle come from the environment. Copying them into a
    // data file would be a second place for them to leak from, for no gain.
    const keep = new MemoryKeep();
    const wallets = new Wallets(keep, [HOUSE]);

    assert.ok(await wallets.signers.forAddress(HOUSE.address));
    assert.equal(wallets.count, 0);
    assert.equal(keep.read("wallets"), undefined);
  });

  it("does not stop user accounts loading alongside them", async () => {
    const keep = new MemoryKeep();
    const made = await new Wallets(keep, [HOUSE]).create();

    const after = new Wallets(keep, [HOUSE]);
    assert.ok(await after.signers.forAddress(made.address));
    assert.ok(await after.signers.forAddress(HOUSE.address));
  });
});

describe("without a Keep of its own", () => {
  it("still works, and simply forgets", async () => {
    const wallets = new Wallets(new MemoryKeep());
    const made = await wallets.create();
    assert.ok(await wallets.signers.forAddress(made.address));
  });
});
