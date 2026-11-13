import { test } from "node:test";
import assert from "node:assert/strict";
import { notAnXHandle, toXHandle } from "./x-handle";

test("reads an X username however it is typed", () => {
  assert.deepEqual(toXHandle("@Amaka_01"), { platform: "x", username: "amaka_01" });
  assert.deepEqual(toXHandle("  tunde "), { platform: "x", username: "tunde" });
});

test("refuses a NEAR account typed as a handle, so nothing waits for a name no one can sign in as", () => {
  assert.equal(toXHandle("selkiepay.x.selkiepay.testnet"), null);
  assert.match(notAnXHandle("selkiepay.x.selkiepay.testnet"), /NEAR account.*address/);
});

test("refuses what X would never allow: too long, spaces, symbols, empty", () => {
  assert.equal(toXHandle("a_name_far_too_long"), null);
  assert.equal(toXHandle("two words"), null);
  assert.equal(toXHandle("me@example.com"), null);
  assert.equal(toXHandle("@"), null);
  assert.equal(notAnXHandle(""), "Add the handle you want to pay.");
  assert.match(notAnXHandle("two words"), /up to 15 letters/);
});
