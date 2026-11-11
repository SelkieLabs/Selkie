import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { candidateAccountIds, handleLabel, isValidAccountId } from "./names";

const PARENT = "x.selkiepay.testnet";

describe("handle -> account name", () => {
  it("lowercases and drops the @", () => {
    assert.equal(handleLabel("@Amaka"), "amaka");
  });

  it("strips underscores at either end and collapses repeats", () => {
    assert.equal(handleLabel("_amaka_"), "amaka");
    assert.equal(handleLabel("__a__b__"), "a_b");
    assert.equal(handleLabel("Amaka__Obi"), "amaka_obi");
  });

  it("keeps digits", () => {
    assert.equal(handleLabel("tunde2024"), "tunde2024");
    assert.equal(handleLabel("123"), "123");
  });

  it("gives up on a handle with nothing usable left", () => {
    assert.equal(handleLabel("___"), null);
    assert.equal(handleLabel(""), null);
  });

  it("offers the handle, then handle-NNNN, then x<id>", () => {
    assert.deepEqual(candidateAccountIds("Amaka", "2078551869207506944", PARENT), [
      "amaka.x.selkiepay.testnet",
      "amaka-6944.x.selkiepay.testnet",
      "x2078551869207506944.x.selkiepay.testnet",
    ]);
  });

  it("falls straight to x<id> when the handle is unusable", () => {
    assert.deepEqual(candidateAccountIds("___", "42", PARENT), ["x42.x.selkiepay.testnet"]);
  });

  it("only ever produces ids NEAR accepts", () => {
    for (const u of ["A", "_a_", "a_b_c", "zz9", "Elon_Musk__", "x"]) {
      for (const id of candidateAccountIds(u, "1234567890", PARENT)) assert.ok(isValidAccountId(id), id);
    }
  });

  it("matches nearcore's account id rules", () => {
    assert.ok(isValidAccountId("ab"));
    assert.ok(isValidAccountId("amaka.x.selkiepay.testnet"));
    assert.ok(!isValidAccountId("a"));
    assert.ok(!isValidAccountId("a".repeat(65)));
    assert.ok(!isValidAccountId("Amaka.testnet"));
    assert.ok(!isValidAccountId("a__b.testnet"));
    assert.ok(!isValidAccountId("_a.testnet"));
    assert.ok(!isValidAccountId("a-.testnet"));
    assert.ok(!isValidAccountId("a..testnet"));
  });
});
