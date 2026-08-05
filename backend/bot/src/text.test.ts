import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cap, lines, weigh, MAX_WEIGHT } from "./text";

describe("measuring a reply the way X does", () => {
  it("counts plain text one for one", () => {
    assert.equal(weigh("hello"), 5);
  });

  it("counts an emoji as two, because X does", () => {
    // The whole reason this file exists. `"✅".length` is 1 and X charges 2, so
    // a reply full of emoji is longer than JavaScript thinks it is.
    assert.equal(weigh("✅"), 2);
    assert.equal(weigh("💸"), 2);
  });

  it("counts a link as 23 however long it is", () => {
    // X rewrites every URL to a t.co one, so the real cost is fixed.
    assert.equal(weigh("https://selkiepay.vercel.app"), 23);
    assert.equal(weigh("selkiepay.vercel.app/docs"), 23);
  });

  it("counts the text around a link as well", () => {
    assert.equal(weigh("go selkiepay.vercel.app"), 3 + 23);
  });

  it("counts a newline", () => {
    assert.equal(weigh("a\nb"), 3);
  });
});

describe("trimming to fit", () => {
  it("leaves a reply that already fits completely alone", () => {
    const text = "✅ Sent!\n\n💸 @bo got 5 USDC";
    assert.equal(cap(text), text);
  });

  it("cuts an over-long reply down to the limit", () => {
    const capped = cap("word ".repeat(200));
    assert.ok(weigh(capped) <= MAX_WEIGHT, `still ${weigh(capped)}`);
    assert.ok(capped.endsWith("…"));
  });

  it("cuts on a word, never through one", () => {
    const capped = cap(`${"alpha ".repeat(60)}omega`);
    assert.doesNotMatch(capped, /alph…$/, "a half-written word reads as a bug");
    assert.match(capped, /alpha…$/);
  });

  it("measures the cut in X's units, not JavaScript's", () => {
    // 200 emoji is 200 by `.length` and 400 to X. Trimming on `.length` would
    // send this as it stands and X would refuse the whole reply.
    const capped = cap("💸".repeat(200));
    assert.ok(weigh(capped) <= MAX_WEIGHT, `still ${weigh(capped)}`);
    assert.ok(capped.length < 200, "and it really was shortened");
  });
});

describe("composing a reply", () => {
  it("drops the parts that are not there, rather than leaving a hole", () => {
    assert.equal(lines("a", false, "b", undefined, null, "c"), "a\nb\nc");
  });

  it("keeps a deliberate blank line", () => {
    assert.equal(lines("a", "", "b"), "a\n\nb");
  });
});
