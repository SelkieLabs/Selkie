import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { Seal, SealError, sameSecret } from "./seal";

const SECRET = "SBSECRETKEYTHATLOOKSLIKEASTELLARSEEDAAAAAAAAAAAAAAAAAAAA";
const ADDRESS = "GAMAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "GABOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO";

const keyOf = (version: number) => ({ version, key: randomBytes(32) });
const env = (version: number, key: Buffer) => `${version}:${key.toString("base64")}`;

describe("sealing account keys", () => {
  it("gives back exactly what it was given", () => {
    const seal = new Seal([keyOf(1)]);
    assert.equal(seal.open(seal.seal(SECRET, ADDRESS), ADDRESS), SECRET);
  });

  it("does not leave the secret readable in the ciphertext", () => {
    const seal = new Seal([keyOf(1)]);
    const sealed = seal.seal(SECRET, ADDRESS);
    assert.equal(sealed.ciphertext.includes(SECRET), false);
    assert.equal(sealed.ciphertext.toString("utf8").includes(SECRET.slice(0, 8)), false);
  });

  it("seals the same secret differently every time", () => {
    // Otherwise two accounts with the same key are visibly the same account,
    // and a repeated row leaks that on its own.
    const seal = new Seal([keyOf(1)]);
    const a = seal.seal(SECRET, ADDRESS);
    const b = seal.seal(SECRET, ADDRESS);
    assert.notEqual(a.ciphertext.toString("hex"), b.ciphertext.toString("hex"));
    assert.notEqual(a.iv.toString("hex"), b.iv.toString("hex"));
  });

  it("refuses to open a row moved onto another address", () => {
    // The reason the address is authenticated. Without it, swapping the address
    // column on two rows hands one person's key to the other's account.
    const seal = new Seal([keyOf(1)]);
    const sealed = seal.seal(SECRET, ADDRESS);
    assert.throws(() => seal.open(sealed, OTHER), SealError);
  });

  it("refuses to open a row somebody edited", () => {
    const seal = new Seal([keyOf(1)]);
    const sealed = seal.seal(SECRET, ADDRESS);
    sealed.ciphertext.writeUInt8(sealed.ciphertext.readUInt8(0) ^ 0xff, 0);
    assert.throws(() => seal.open(sealed, ADDRESS), SealError);
  });

  it("refuses a wrong key rather than returning nonsense", () => {
    const sealed = new Seal([keyOf(1)]).seal(SECRET, ADDRESS);
    const impostor = new Seal([{ version: 1, key: randomBytes(32) }]);
    assert.throws(() => impostor.open(sealed, ADDRESS), SealError);
  });

  it("keeps opening what an older key sealed", () => {
    // Rotation. The old key stays configured until everything under it has been
    // re-sealed, and until then both have to work.
    const old = keyOf(1);
    const fresh = keyOf(2);
    const before = new Seal([old]).seal(SECRET, ADDRESS);

    const after = new Seal([fresh, old]);
    assert.equal(after.open(before, ADDRESS), SECRET);
    assert.equal(after.isCurrent(before), false);
    assert.equal(after.isCurrent(after.seal(SECRET, ADDRESS)), true);
  });

  it("says so plainly when the key that sealed a row is gone", () => {
    const sealed = new Seal([keyOf(1)]).seal(SECRET, ADDRESS);
    const seal = new Seal([keyOf(2)]);
    assert.throws(() => seal.open(sealed, ADDRESS), /not configured/);
  });

  it("will not start on a missing, malformed, or wrong-length key", () => {
    assert.throws(() => Seal.fromEnv(undefined), /is not set/);
    assert.throws(() => Seal.fromEnv("not-a-key"), /1:<base64>/);
    assert.throws(() => Seal.fromEnv("0:" + randomBytes(32).toString("base64")), /1:<base64>/);
    assert.throws(() => Seal.fromEnv("1:" + randomBytes(16).toString("base64")), /16 bytes/);
    assert.throws(() => new Seal([]), SealError);
  });

  it("refuses two keys claiming the same version", () => {
    // Silently picking one would make which key opens a row a coin flip.
    const key = randomBytes(32);
    assert.throws(() => Seal.fromEnv(`${env(1, key)},${env(1, randomBytes(32))}`), /both call themselves/);
  });

  it("reads a rotation list from the environment, newest first", () => {
    const one = randomBytes(32);
    const two = randomBytes(32);
    const before = new Seal([{ version: 1, key: one }]).seal(SECRET, ADDRESS);

    const seal = Seal.fromEnv(`${env(2, two)}, ${env(1, one)}`);
    assert.equal(seal.open(before, ADDRESS), SECRET);
    assert.equal(seal.seal(SECRET, ADDRESS).keyVersion, 2);
  });
});

describe("comparing secrets", () => {
  it("matches equal values and rejects everything else", () => {
    assert.equal(sameSecret("shhh", "shhh"), true);
    assert.equal(sameSecret("shhh", "shh"), false);
    assert.equal(sameSecret("shhh", "shhhh"), false);
    assert.equal(sameSecret("", ""), true);
  });
});
