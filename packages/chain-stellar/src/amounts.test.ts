import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AmountError,
  applySlippage,
  assertPositive,
  fromStroops,
  toStellarAmount,
  toStroops,
} from "./amounts";

test("converts decimal strings to stroops exactly", () => {
  assert.equal(toStroops("1"), 10_000_000n);
  assert.equal(toStroops("10.5"), 105_000_000n);
  assert.equal(toStroops("0.0000001"), 1n);
  assert.equal(toStroops("0"), 0n);
  assert.equal(toStroops("-2.5"), -25_000_000n);
});

test("survives the amounts floating point gets wrong", () => {
  // 0.1 + 0.2 !== 0.3 in floats. In stroops it is exact, which is the
  // entire reason money never touches a Number in this codebase.
  assert.equal(toStroops("0.1") + toStroops("0.2"), toStroops("0.3"));

  // A balance big enough to lose precision as a double.
  const huge = "92233720368.5477580";
  assert.equal(fromStroops(toStroops(huge)), "92233720368.547758");
});

test("refuses precision it cannot represent instead of silently rounding", () => {
  assert.throws(() => toStroops("0.00000001"), AmountError);
  assert.throws(() => toStroops("1.123456789"), AmountError);
});

test("rejects anything that is not a plain decimal", () => {
  for (const bad of ["", " ", "abc", "1e5", "0x10", "1,5", "1.2.3", "Infinity", "NaN", "--1", "+1"]) {
    assert.throws(() => toStroops(bad), AmountError, `should reject ${JSON.stringify(bad)}`);
  }
});

test("formats stroops back to clean decimal strings", () => {
  assert.equal(fromStroops(105_000_000n), "10.5");
  assert.equal(fromStroops(0n), "0");
  assert.equal(fromStroops(1n), "0.0000001");
  assert.equal(fromStroops(10_000_000n), "1");
  assert.equal(fromStroops(-25_000_000n), "-2.5");
});

test("round trips every amount unchanged", () => {
  for (const amount of ["0", "1", "0.0000001", "123456.789", "999999999.9999999", "-0.5"]) {
    assert.equal(fromStroops(toStroops(amount)), normalize(amount));
  }
});

test("normalizes the padded strings Horizon returns", () => {
  assert.equal(toStellarAmount("25.0000000"), "25");
  assert.equal(toStellarAmount("0.5000000"), "0.5");
  assert.equal(toStellarAmount("0.0000000"), "0");
});

test("applies slippage as a floor, never above the quote", () => {
  assert.equal(applySlippage(1_000_000n, 0), 1_000_000n);
  assert.equal(applySlippage(1_000_000n, 100), 990_000n); // 1%
  assert.equal(applySlippage(1_000_000n, 5_000), 500_000n); // 50%
  // Rounding goes down, so the floor is never optimistic.
  assert.equal(applySlippage(7n, 100), 6n);
});

test("rejects nonsense slippage rather than trading on it", () => {
  for (const bad of [-1, 10_000, 20_000, 1.5, NaN]) {
    assert.throws(() => applySlippage(1_000n, bad), AmountError);
  }
});

test("assertPositive blocks zero and negative payments", () => {
  assert.equal(assertPositive("0.0000001"), 1n);
  assert.throws(() => assertPositive("0"), AmountError);
  assert.throws(() => assertPositive("-1"), AmountError);
});

/** Strip trailing zeros the way fromStroops does, for round-trip comparison. */
function normalize(amount: string): string {
  if (!amount.includes(".")) return amount;
  const trimmed = amount.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "-0" ? "0" : trimmed;
}
