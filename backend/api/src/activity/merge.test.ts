import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HistoryEntry } from "@selkie/core";
import { mergeActivity } from "../app";

const entry = (over: Partial<HistoryEntry> & { at: string }): HistoryEntry => ({
  id: over.id ?? `id_${over.at}`,
  kind: over.kind ?? "receive",
  chain: "stellar",
  amount: over.amount ?? { amount: "10", asset: "USDC" },
  status: over.status ?? "confirmed",
  ...over,
});

describe("merging the ledger into the feed", () => {
  it("keeps deposits Selkie never wrote down", () => {
    const merged = mergeActivity(
      [entry({ at: "2026-08-04T10:00:00Z", id: "sent", kind: "send", ref: "aaa" })],
      [entry({ at: "2026-08-04T11:00:00Z", id: "chain_1", ref: "bbb" })],
      50,
    );

    assert.equal(merged.length, 2);
    // Newest first, across both sources.
    assert.equal(merged[0]!.id, "chain_1");
    assert.equal(merged[1]!.id, "sent");
  });

  it("shows a transaction once, described by Selkie rather than the ledger", () => {
    const mine = entry({
      at: "2026-08-04T10:00:00Z",
      id: "mine",
      ref: "same",
      counterparty: "@amaka",
    });
    const chain = entry({ at: "2026-08-04T10:00:00Z", id: "chain_1", ref: "same" });

    const merged = mergeActivity([mine], [chain], 50);

    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.id, "mine");
    // The whole reason to prefer it: the ledger does not know who @amaka is.
    assert.equal(merged[0]!.counterparty, "@amaka");
  });

  it("does not let an entry with no ref swallow every deposit", () => {
    // A payment still waiting to be claimed has no transaction hash yet. If
    // undefined counted as a known ref, the first such entry would hide all
    // deposits that also had none.
    const waiting = entry({ at: "2026-08-04T09:00:00Z", id: "waiting", status: "pending" });
    const deposit = entry({ at: "2026-08-04T10:00:00Z", id: "chain_1", ref: "bbb" });

    const merged = mergeActivity([waiting], [deposit], 50);

    assert.equal(merged.length, 2);
  });

  it("caps the merged feed, not each source separately", () => {
    const mine = [entry({ at: "2026-08-04T10:00:00Z", id: "a", ref: "1" })];
    const deposits = [
      entry({ at: "2026-08-04T12:00:00Z", id: "b", ref: "2" }),
      entry({ at: "2026-08-04T11:00:00Z", id: "c", ref: "3" }),
    ];

    const merged = mergeActivity(mine, deposits, 2);

    assert.equal(merged.length, 2);
    assert.deepEqual(
      merged.map((row) => row.id),
      ["b", "c"],
    );
  });
});
