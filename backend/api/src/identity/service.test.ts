import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { StellarAdapter } from "@selkie/chain-stellar";
import { FakeIdentityProvider } from "./provider";
import { IdentityService } from "./service";
import { InMemoryUserStore } from "./store";
import { userHandles } from "./types";

/**
 * These tests are the account model's specification. The scenario that drives
 * them is the one Martin asked about: someone arrives through Google, gets paid
 * at an X handle they have not linked yet, and must not end up with two wallets.
 */

/** A stand-in for the chain that records what it was asked to do. */
class AdapterSpy {
  addresses = 0;
  pending = new Map<string, bigint[]>();
  claims: string[] = [];
  transfers: { from: string; to: string; amount: string; asset: string }[] = [];
  balances = new Map<string, { amount: string; asset: string }[]>();

  async ensureAccount(handle: { platform: string; username: string }) {
    this.addresses += 1;
    return {
      chain: "stellar" as const,
      handle,
      address: `G_ADDRESS_${this.addresses}`,
      status: "provisioning" as const,
    };
  }

  async pendingClaims(handle: { platform: string; username: string }) {
    return this.pending.get(`${handle.platform}:${handle.username}`) ?? [];
  }

  async claim(handle: { platform: string; username: string }) {
    const key = `${handle.platform}:${handle.username}`;
    this.claims.push(key);
    this.pending.delete(key);
    return { status: "confirmed" as const, ref: `TX_${this.claims.length}` };
  }

  async getBalance(account: { address: string }) {
    return {
      account,
      balances: this.balances.get(account.address) ?? [{ amount: "0", asset: "USDC" }],
    };
  }

  async transfer(params: {
    fromAddress: string;
    toAddress: string;
    amount: { amount: string; asset: string };
  }) {
    this.transfers.push({
      from: params.fromAddress,
      to: params.toAddress,
      amount: params.amount.amount,
      asset: params.amount.asset,
    });
    return { status: "confirmed" as const, ref: "TX_SWEEP" };
  }
}

const googleToken = (subject: string) => `test:google:${subject}:`;
const xToken = (subject: string, username: string) => `test:x:${subject}:${username}`;
const telegramToken = (subject: string, username: string) => `test:telegram:${subject}:${username}`;

describe("identity", () => {
  let users: InMemoryUserStore;
  let adapter: AdapterSpy;
  let service: IdentityService;

  beforeEach(() => {
    users = new InMemoryUserStore();
    adapter = new AdapterSpy();
    service = new IdentityService({
      users,
      provider: new FakeIdentityProvider(true),
      adapter: adapter as unknown as StellarAdapter,
    });
  });

  test("an unknown identity does not silently become an account", async () => {
    // This is the guard that prevents the second wallet. The UI asks once.
    const result = await service.signIn(googleToken("g1"), { createIfMissing: false });
    assert.equal(result, null);
  });

  test("signing up creates one account with one wallet", async () => {
    const result = await service.signIn(googleToken("g1"), { createIfMissing: true });
    assert.ok(result);
    assert.equal(result.isNew, true);
    assert.equal(result.user.identities.length, 1);
    assert.match(result.user.address, /^G_ADDRESS_/);
  });

  test("signing in again returns the same account, not a new one", async () => {
    const first = await service.signIn(googleToken("g1"), { createIfMissing: true });
    const second = await service.signIn(googleToken("g1"), { createIfMissing: true });
    assert.equal(second?.isNew, false);
    assert.equal(second?.user.id, first?.user.id);
    assert.equal(second?.user.address, first?.user.address);
  });

  test("a Google account has no payable handle until it links one", async () => {
    const result = await service.signIn(googleToken("g1"), { createIfMissing: true });
    // Nobody sends money to a Gmail address.
    assert.deepEqual(userHandles(result!.user), []);
  });

  test("linking X makes the handle payable and keeps ONE wallet", async () => {
    const signup = await service.signIn(googleToken("g1"), { createIfMissing: true });
    const walletBefore = signup!.user.address;

    const linked = await service.link(signup!.user.id, xToken("x-42", "amaka"));

    assert.equal(linked.status, "linked");
    assert.equal(linked.user.address, walletBefore, "linking must not create a second wallet");
    assert.equal(linked.user.identities.length, 2);
    assert.deepEqual(userHandles(linked.user), [{ platform: "x", username: "amaka" }]);
  });

  test("linking X releases money that was already waiting for the handle", async () => {
    // Someone paid @amaka before she ever heard of Selkie.
    adapter.pending.set("x:amaka", [1n, 2n]);

    const signup = await service.signIn(googleToken("g1"), { createIfMissing: true });
    const linked = await service.link(signup!.user.id, xToken("x-42", "amaka"));

    assert.equal(linked.claimed.length, 1);
    assert.deepEqual(linked.claimed[0]?.handle, { platform: "x", username: "amaka" });
    assert.equal(linked.claimed[0]?.released, 2);
    assert.deepEqual(adapter.claims, ["x:amaka"]);
  });

  test("signing up straight through X claims waiting money immediately", async () => {
    adapter.pending.set("x:amaka", [7n]);
    const result = await service.signIn(xToken("x-42", "amaka"), { createIfMissing: true });
    assert.equal(result?.claimed[0]?.released, 1);
  });

  test("nothing waiting means nothing is claimed", async () => {
    const result = await service.signIn(xToken("x-42", "amaka"), { createIfMissing: true });
    assert.deepEqual(result?.claimed, []);
    assert.deepEqual(adapter.claims, []);
  });

  test("linking an identity owned by another account asks to merge, never merges", async () => {
    const viaX = await service.signIn(xToken("x-42", "amaka"), { createIfMissing: true });
    const viaGoogle = await service.signIn(googleToken("g1"), { createIfMissing: true });

    const attempt = await service.link(viaGoogle!.user.id, xToken("x-42", "amaka"));

    assert.equal(attempt.status, "merge-required");
    assert.equal(attempt.mergeCandidate?.userId, viaX!.user.id);
    // Nothing moved. Merging money is never a side effect of tapping "link".
    assert.deepEqual(adapter.transfers, []);
    assert.equal(attempt.user.identities.length, 1);
  });

  test("merging moves the money, then the identities, then closes the account", async () => {
    const viaX = await service.signIn(xToken("x-42", "amaka"), { createIfMissing: true });
    const viaGoogle = await service.signIn(googleToken("g1"), { createIfMissing: true });
    adapter.balances.set(viaX!.user.address, [{ amount: "10", asset: "USDC" }]);

    const merged = await service.merge(viaGoogle!.user.id, viaX!.user.id);

    assert.equal(merged.identities.length, 2, "both identities live on the surviving account");
    assert.deepEqual(adapter.transfers, [
      { from: viaX!.user.address, to: viaGoogle!.user.address, amount: "10", asset: "USDC" },
    ]);
    assert.equal(await users.get(viaX!.user.id), null, "the emptied account is gone");
    // And the X identity now resolves to the surviving account.
    const owner = await users.findByIdentity("x", "x-42");
    assert.equal(owner?.id, viaGoogle!.user.id);
  });

  test("merging an empty account moves no money", async () => {
    const viaX = await service.signIn(xToken("x-42", "amaka"), { createIfMissing: true });
    const viaGoogle = await service.signIn(googleToken("g1"), { createIfMissing: true });

    await service.merge(viaGoogle!.user.id, viaX!.user.id);
    assert.deepEqual(adapter.transfers, []);
  });

  test("merging into itself is a no-op", async () => {
    const user = await service.signIn(googleToken("g1"), { createIfMissing: true });
    const merged = await service.merge(user!.user.id, user!.user.id);
    assert.equal(merged.id, user!.user.id);
    assert.deepEqual(adapter.transfers, []);
  });

  test("a renamed X handle updates instead of duplicating", async () => {
    const signup = await service.signIn(xToken("x-42", "amaka"), { createIfMissing: true });
    // Same X user id, new @handle. Keying on the permanent id is what makes
    // this safe: the account follows the person, not the string.
    const renamed = await service.signIn(xToken("x-42", "amaka_dev"), { createIfMissing: true });

    assert.equal(renamed?.user.id, signup?.user.id);
    assert.equal(renamed?.user.identities.length, 1);
    assert.deepEqual(userHandles(renamed!.user), [{ platform: "x", username: "amaka_dev" }]);
  });

  test("someone else taking the old handle does not inherit the account", async () => {
    await service.signIn(xToken("x-42", "amaka"), { createIfMissing: true });
    // A different X user id that now owns the freed @amaka handle.
    const impostor = await service.signIn(xToken("x-99", "amaka"), { createIfMissing: true });

    const original = await users.findByIdentity("x", "x-42");
    assert.notEqual(impostor?.user.id, original?.id);
  });

  test("Telegram links alongside X on the same wallet", async () => {
    const signup = await service.signIn(xToken("x-42", "amaka"), { createIfMissing: true });
    const linked = await service.link(signup!.user.id, telegramToken("tg-7", "amaka_tg"));

    assert.equal(linked.status, "linked");
    assert.equal(linked.user.address, signup!.user.address);
    assert.deepEqual(userHandles(linked.user), [
      { platform: "x", username: "amaka" },
      { platform: "telegram", username: "amaka_tg" },
    ]);
  });

  test("linking Telegram releases money waiting at the Telegram handle", async () => {
    adapter.pending.set("telegram:amaka_tg", [3n]);
    const signup = await service.signIn(xToken("x-42", "amaka"), { createIfMissing: true });
    const linked = await service.link(signup!.user.id, telegramToken("tg-7", "amaka_tg"));

    assert.deepEqual(adapter.claims, ["telegram:amaka_tg"]);
    assert.equal(linked.claimed[0]?.released, 1);
  });

  test("handle lookup is case insensitive, because people type how they like", async () => {
    await service.signIn(xToken("x-42", "amaka"), { createIfMissing: true });
    assert.ok(await service.findByHandle("x", "AMAKA"));
    assert.ok(await service.findByHandle("x", "amaka"));
    assert.equal(await service.findByHandle("x", "someone_else"), null);
  });

  test("a forged token is refused", async () => {
    await assert.rejects(() => service.signIn("not-a-real-token", { createIfMissing: true }));
  });

  test("the fake provider cannot be constructed outside tests", () => {
    assert.throws(() => new FakeIdentityProvider(false));
  });
});
