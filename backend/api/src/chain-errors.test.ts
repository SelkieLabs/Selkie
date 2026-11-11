import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TransactionRejectedError } from "@selkie/chain-stellar";
import { explainRejection } from "./app";

const rejected = (operations: string[], transaction = "tx_failed") =>
  new TransactionRejectedError("refused", transaction, operations);

describe("explaining a refused transaction", () => {
  it("names the reason a conversion into an unheld asset fails", () => {
    // The exact failure behind "Something went wrong on our side": converting
    // into an asset the account has never opted into.
    const message = explainRejection(rejected(["op_no_trust"]));
    assert.match(message, /not set up for that yet/);
  });

  it("says plainly when there is not enough money", () => {
    assert.match(explainRejection(rejected(["op_underfunded"])), /balance is too low/);
  });

  it("invites a retry when the price moved, because retrying works", () => {
    assert.match(explainRejection(rejected(["op_under_dest_min"])), /rate moved/);
  });

  it("suggests a smaller amount when the market is too thin", () => {
    assert.match(explainRejection(rejected(["op_too_few_offers"])), /smaller amount/);
  });

  it("falls back to something honest rather than guessing", () => {
    const message = explainRejection(rejected(["op_something_new_entirely"]));
    assert.match(message, /would not accept that/);
    // The reassurance matters: a failed transaction moved nothing.
    assert.match(message, /Nothing moved/);
  });

  it("reads a busy network off the transaction code, not the operations", () => {
    const message = explainRejection(rejected([], "tx_insufficient_fee"));
    assert.match(message, /network is busy/);
  });

  it("never leaks a raw code to the person reading it", () => {
    for (const codes of [["op_no_trust"], ["op_underfunded"], ["op_weird"]]) {
      assert.doesNotMatch(explainRejection(rejected(codes)), /op_|tx_/);
    }
  });
});
