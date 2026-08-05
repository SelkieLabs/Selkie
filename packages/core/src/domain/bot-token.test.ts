import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BotTokenError,
  MIN_BOT_SECRET_LENGTH,
  signBotToken,
  verifyBotToken,
} from "./bot-token";

const SECRET = "x".repeat(MIN_BOT_SECRET_LENGTH);
const OTHER = "y".repeat(MIN_BOT_SECRET_LENGTH);
const AMAKA = { platform: "x", subject: "2078551869207506944", username: "Amaka" } as const;

/** Rebuild a token with an edited payload, keeping the original signature. */
async function tamper(edit: (payload: Record<string, unknown>) => void): Promise<string> {
  const [version, payload, signature] = (await signBotToken(AMAKA, SECRET)).split(".");
  const decoded = JSON.parse(
    Buffer.from(payload!, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  edit(decoded);
  const forged = Buffer.from(JSON.stringify(decoded)).toString("base64url");
  return `${version}.${forged}.${signature}`;
}

describe("a bot token", () => {
  it("carries the identity the platform attested", async () => {
    const claim = await verifyBotToken(await signBotToken(AMAKA, SECRET), SECRET);
    assert.equal(claim.platform, "x");
    assert.equal(claim.subject, "2078551869207506944");
  });

  it("normalizes the handle, because @Amaka and @amaka are one person", async () => {
    const claim = await verifyBotToken(await signBotToken(AMAKA, SECRET), SECRET);
    assert.equal(claim.username, "amaka");
  });

  it("is different every time, so a repeat is visible as a repeat", async () => {
    assert.notEqual(await signBotToken(AMAKA, SECRET), await signBotToken(AMAKA, SECRET));
  });
});

describe("refusing a bot token", () => {
  it("refuses one signed with a different secret", async () => {
    const token = await signBotToken(AMAKA, OTHER);
    await assert.rejects(() => verifyBotToken(token, SECRET), BotTokenError);
  });

  it("refuses one whose payload was edited to name someone else", async () => {
    // The attack this exists to stop: take a real token, swap the subject for
    // the victim's, and spend their balance.
    const forged = await tamper((payload) => {
      payload.subject = "999999";
    });
    await assert.rejects(() => verifyBotToken(forged, SECRET), BotTokenError);
  });

  it("refuses one whose handle was edited, so a reply cannot be redirected", async () => {
    const forged = await tamper((payload) => {
      payload.username = "victim";
    });
    await assert.rejects(() => verifyBotToken(forged, SECRET), BotTokenError);
  });

  it("refuses one whose expiry was pushed out", async () => {
    const forged = await tamper((payload) => {
      payload.expiresAt = Date.now() + 86_400_000;
    });
    await assert.rejects(() => verifyBotToken(forged, SECRET), BotTokenError);
  });

  it("expires, so one copied out of a log is soon worthless", async () => {
    const token = await signBotToken(AMAKA, SECRET, { ttlMs: 1_000 });
    // Past the lifetime and past the clock-skew allowance.
    await assert.rejects(
      () => verifyBotToken(token, SECRET, { now: Date.now() + 120_000 }),
      BotTokenError,
    );
  });

  it("tolerates a clock a little out of step rather than refusing a payment", async () => {
    const token = await signBotToken(AMAKA, SECRET, { ttlMs: 1_000 });
    await assert.doesNotReject(() => verifyBotToken(token, SECRET, { now: Date.now() + 5_000 }));
  });

  it("refuses a token from a future format instead of guessing at it", async () => {
    const token = (await signBotToken(AMAKA, SECRET)).replace(/^sb1\./, "sb2.");
    await assert.rejects(() => verifyBotToken(token, SECRET), BotTokenError);
  });

  it("refuses rubbish without crashing", async () => {
    for (const junk of ["", ".", "a.b", "a.b.c.d", "sb1..", "sb1.!!!.!!!", "sb1.@@@.###"]) {
      await assert.rejects(() => verifyBotToken(junk, SECRET), BotTokenError);
    }
  });

  it("refuses a signature of the wrong length rather than throwing from the comparison", async () => {
    const [version, payload] = (await signBotToken(AMAKA, SECRET)).split(".");
    await assert.rejects(() => verifyBotToken(`${version}.${payload}.short`, SECRET), BotTokenError);
  });
});

describe("what a bot may never do", () => {
  it("cannot mint a Google identity, because that is a login and not an address", async () => {
    await assert.rejects(
      () => signBotToken({ platform: "google" as never, subject: "1" }, SECRET),
      BotTokenError,
    );
  });

  it("cannot verify a signed token that names a login-only provider", async () => {
    // Belt and braces: even if such a token were minted by a future bug, it is
    // refused on the way in.
    const payload = Buffer.from(
      JSON.stringify({
        platform: "google",
        subject: "1",
        nonce: "n",
        expiresAt: Date.now() + 60_000,
      }),
    ).toString("base64url");
    const body = `sb1.${payload}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = Buffer.from(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
    ).toString("base64url");

    await assert.rejects(() => verifyBotToken(`${body}.${signature}`, SECRET), BotTokenError);
  });

  it("cannot act for nobody", async () => {
    await assert.rejects(
      () => signBotToken({ platform: "x", subject: "" }, SECRET),
      BotTokenError,
    );
  });

  it("refuses to work with a secret short enough to guess", async () => {
    await assert.rejects(() => signBotToken(AMAKA, "tooshort"), BotTokenError);
    const token = await signBotToken(AMAKA, SECRET);
    await assert.rejects(() => verifyBotToken(token, "tooshort"), BotTokenError);
  });
});
