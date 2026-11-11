import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { handleHashHex, parseHandle, xIdHashHex } from "./handle";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("recipient keys", () => {
  it("hashes a username the way the Stellar escrow always has", async () => {
    assert.equal(await handleHashHex(parseHandle("@Amaka", "x")), sha256("x:amaka"));
  });

  it("hashes an X user id under its own prefix, so it can never collide with a username", async () => {
    assert.equal(await xIdHashHex("2078551869207506944"), sha256("x-id:2078551869207506944"));
    // A username made of digits is still a username, and lands somewhere else.
    assert.notEqual(await xIdHashHex("12345"), await handleHashHex(parseHandle("12345", "x")));
  });

  it("refuses anything that is not a numeric id", async () => {
    await assert.rejects(xIdHashHex("amaka"));
    await assert.rejects(xIdHashHex(""));
    await assert.rejects(xIdHashHex("123 "));
  });
});
