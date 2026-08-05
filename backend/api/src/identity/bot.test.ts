import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_BOT_SECRET_LENGTH, signBotToken } from "@selkie/core";
import { BotIdentityProvider } from "./bot";
import { CompositeIdentityProvider } from "./composite";
import { FakeIdentityProvider, IdentityVerificationError } from "./provider";
import type { IdentityProvider } from "./provider";
import type { VerifiedIdentity } from "./types";

const SECRET = "b".repeat(MIN_BOT_SECRET_LENGTH);
const AMAKA = { platform: "x", subject: "1234567890", username: "Amaka" } as const;

describe("the bot identity provider", () => {
  it("reports the author the platform vouched for", async () => {
    const provider = new BotIdentityProvider(SECRET);
    const [identity] = await provider.verify(await signBotToken(AMAKA, SECRET));

    assert.equal(identity?.provider, "x");
    // The numeric id, not the handle: handles get renamed and reused.
    assert.equal(identity?.subject, "1234567890");
    assert.equal(identity?.username, "amaka");
  });

  it("refuses a token it did not sign, in the shape every provider fails in", async () => {
    const provider = new BotIdentityProvider(SECRET);
    const forged = await signBotToken(AMAKA, "z".repeat(MIN_BOT_SECRET_LENGTH));

    await assert.rejects(() => provider.verify(forged), IdentityVerificationError);
  });

  it("will not start with a weak secret, so the failure is at boot not mid-payment", () => {
    assert.throws(() => new BotIdentityProvider("short"));
  });

  it("provisions no wallet, so a leaked secret cannot conjure an account", () => {
    const provider: IdentityProvider = new BotIdentityProvider(SECRET);
    assert.equal(provider.walletAddress, undefined);
  });

  it("vouches for authorship and never for ownership", async () => {
    // The distinction the whole design rests on: X said they wrote a message,
    // which is not the same as them signing in and proving the account is
    // theirs. Only the latter may create a wallet or claim a handle.
    const provider = new BotIdentityProvider(SECRET);
    const [identity] = await provider.verify(await signBotToken(AMAKA, SECRET));

    assert.equal(identity?.attestation, "authorship");
  });
});

describe("several providers behind one API", () => {
  const composite = () =>
    new CompositeIdentityProvider([new BotIdentityProvider(SECRET), new FakeIdentityProvider(true)]);

  it("accepts a bot token", async () => {
    const [identity] = await composite().verify(await signBotToken(AMAKA, SECRET));
    assert.equal(identity?.subject, "1234567890");
  });

  it("accepts a login token, falling past the provider that does not know it", async () => {
    const [identity] = await composite().verify("test:x:99:amaka");
    assert.equal(identity?.subject, "99");
  });

  it("refuses a token nobody recognises without saying who refused it", async () => {
    await assert.rejects(() => composite().verify("nonsense"), (error: Error) => {
      assert.ok(error instanceof IdentityVerificationError);
      // Naming the provider would let someone map out what we accept.
      assert.doesNotMatch(error.message, /bot|privy|fake/i);
      return true;
    });
  });

  it("lets a real fault through rather than reporting it as a bad password", async () => {
    // Privy being down must not read as "your sign-in is invalid" to every user
    // at once. Only a verification failure means "not mine, try the next one".
    const broken: IdentityProvider = {
      id: "broken",
      verify: async () => {
        throw new Error("Privy is down");
      },
    };
    const provider = new CompositeIdentityProvider([broken, new FakeIdentityProvider(true)]);

    await assert.rejects(() => provider.verify("test:x:99:amaka"), /Privy is down/);
  });

  it("asks only the provider that issued the token where the wallet is", async () => {
    let askedWithToken: string | null = null;
    const keyholder: IdentityProvider = {
      id: "keyholder",
      verify: async (token): Promise<VerifiedIdentity[]> => {
        if (token !== "keyholder-token") throw new IdentityVerificationError("not mine");
        return [{ provider: "google", subject: "g1", attestation: "login" }];
      },
      walletAddress: async (token) => {
        askedWithToken = token;
        return "GADDRESS";
      },
    };
    const provider = new CompositeIdentityProvider([new BotIdentityProvider(SECRET), keyholder]);

    // A bot token must never reach the keyholder's wallet lookup.
    assert.equal(await provider.walletAddress(await signBotToken(AMAKA, SECRET)), null);
    assert.equal(askedWithToken, null);

    assert.equal(await provider.walletAddress("keyholder-token"), "GADDRESS");
    assert.equal(askedWithToken, "keyholder-token");
  });

  it("refuses to exist with no providers at all", () => {
    assert.throws(() => new CompositeIdentityProvider([]));
  });
});
