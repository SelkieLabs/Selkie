import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, test } from "node:test";
import { PrivyIdentityProvider } from "./privy";
import { IdentityVerificationError } from "./provider";

/**
 * Token verification is the one check standing between a stranger and someone
 * else's money. These tests are the attack list: forged signatures, tokens
 * minted for a different app, expired tokens, and the classic trick of letting
 * the token choose an algorithm that needs no key at all.
 */

const APP_ID = "app-selkie";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const { privateKey: otherKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

const verificationKey = publicKey.export({ type: "spki", format: "pem" }).toString();

const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Mint a token the way Privy does: ES256 over header.payload, raw r||s. */
function mint(
  payload: Record<string, unknown> = {},
  options: { header?: Record<string, unknown>; key?: typeof privateKey } = {},
): string {
  const header = options.header ?? { alg: "ES256", typ: "JWT" };
  const body = {
    iss: "privy.io",
    aud: APP_ID,
    sub: "did:privy:user-1",
    exp: Math.floor(Date.now() / 1000) + 600,
    ...payload,
  };
  const signed = `${segment(header)}.${segment(body)}`;
  const signer = createSign("sha256");
  signer.update(signed);
  const signature = signer.sign({ key: options.key ?? privateKey, dsaEncoding: "ieee-p1363" });
  return `${signed}.${signature.toString("base64url")}`;
}

const provider = () =>
  new PrivyIdentityProvider({
    appId: APP_ID,
    appSecret: "secret",
    verificationKey,
    // Never reached: every test here fails before any network call, and one
    // asserts that a good token gets as far as asking for the subject.
    apiUrl: "http://127.0.0.1:1",
  });

const refuses = async (token: string, because: RegExp) => {
  await assert.rejects(
    () => provider().subjectOf(token),
    (error: unknown) => {
      assert.ok(error instanceof IdentityVerificationError, "wrong error type");
      assert.match(error.message, because);
      return true;
    },
  );
};

describe("privy token verification", () => {
  test("a real token yields the subject Privy signed", async () => {
    assert.equal(await provider().subjectOf(mint()), "did:privy:user-1");
  });

  test("a tampered payload is refused", async () => {
    const token = mint();
    const [header, , signature] = token.split(".");
    const forged = segment({
      iss: "privy.io",
      aud: APP_ID,
      sub: "did:privy:someone-else",
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    await refuses(`${header}.${forged}.${signature}`, /signature/);
  });

  test("a token signed with the wrong key is refused", async () => {
    await refuses(mint({}, { key: otherKey }), /signature/);
  });

  test("a token that picks its own algorithm is refused", async () => {
    // The alg:none trick: strip the signature and claim it was never needed.
    const unsigned = `${segment({ alg: "none", typ: "JWT" })}.${segment({
      iss: "privy.io",
      aud: APP_ID,
      sub: "did:privy:intruder",
      exp: Math.floor(Date.now() / 1000) + 600,
    })}.`;
    await refuses(unsigned, /algorithm/);
  });

  test("HS256 signed with the public key as the secret is refused", async () => {
    // The other half of the algorithm-confusion family: treat the public key as
    // a shared secret. Refused before the signature is ever looked at.
    await refuses(mint({}, { header: { alg: "HS256", typ: "JWT" } }), /algorithm/);
  });

  test("a valid token minted for another app is refused", async () => {
    await refuses(mint({ aud: "app-someone-else" }), /audience/);
  });

  test("a token from the wrong issuer is refused", async () => {
    await refuses(mint({ iss: "auth.example.com" }), /issuer/);
  });

  test("an expired token is refused, with no grace period", async () => {
    await refuses(mint({ exp: Math.floor(Date.now() / 1000) - 1 }), /expired/);
  });

  test("a token with no expiry is refused rather than treated as forever", async () => {
    await refuses(mint({ exp: undefined }), /expired/);
  });

  test("a token with no subject is refused", async () => {
    await refuses(mint({ sub: "" }), /subject/);
  });

  test("garbage is refused without throwing something unexpected", async () => {
    await refuses("not-a-token", /not a token/);
    await refuses("a.b.c", /unreadable/);
  });

  test("the failure never contains the token", async () => {
    const token = mint({ aud: "app-someone-else" });
    await assert.rejects(
      () => provider().subjectOf(token),
      (error: unknown) => {
        assert.ok(!(error as Error).message.includes(token));
        return true;
      },
    );
  });
});
