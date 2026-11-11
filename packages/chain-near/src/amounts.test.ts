import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AmountError, fromBaseUnits, toBaseUnits, toPositiveBaseUnits } from "./amounts";

describe("USDC amounts", () => {
  it("round-trips decimal strings through base units", () => {
    assert.equal(toBaseUnits("1.50"), 1_500_000n);
    assert.equal(toBaseUnits("0.000001"), 1n);
    assert.equal(toBaseUnits("12"), 12_000_000n);
    assert.equal(fromBaseUnits(1_500_000n), "1.5");
    assert.equal(fromBaseUnits("1"), "0.000001");
    assert.equal(fromBaseUnits(0n), "0");
  });

  it("refuses precision it would have to drop", () => {
    assert.throws(() => toBaseUnits("0.0000001"), AmountError);
  });

  it("refuses junk and negatives", () => {
    for (const bad of ["", "abc", "1e6", "-1", "1.", ".5", "1,000"]) {
      assert.throws(() => toBaseUnits(bad), AmountError, bad);
    }
    assert.throws(() => fromBaseUnits(-1n), AmountError);
  });

  it("refuses zero for anything that moves money", () => {
    assert.throws(() => toPositiveBaseUnits("0.00"), AmountError);
    assert.equal(toPositiveBaseUnits("0.01"), 10_000n);
  });
});
