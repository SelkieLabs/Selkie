import { BotTokenError, assertUsableBotSecret, verifyBotToken } from "@selkie/core";
import { IdentityVerificationError } from "./provider";
import type { IdentityProvider } from "./provider";
import type { VerifiedIdentity } from "./types";

/**
 * Lets the X and Telegram workers act for the person who messaged them.
 *
 * A bot holds no login for that person, so it cannot send a Privy token. What it
 * can do is repeat what the platform told it: X's own API said this numeric
 * author id wrote this tweet. Restating that in a signed token makes the bot one
 * more identity provider rather than a hole cut through the side of the API, and
 * that is the point. Every guard on every route stays exactly where it is: the
 * rate limits, the idempotency keys, the address typo check, the escrow rules.
 * The bot gets no privilege the web app does not have.
 *
 * What it cannot do is invent an account. `requireUser` signs in with
 * `createIfMissing: false`, so a stranger tweeting a command at Selkie for the
 * first time is not quietly given a wallet with money in it. They are told to
 * open the app. Money can still be sent TO them, because that is escrow and
 * needs no account at all.
 *
 * Install it only where a bot actually runs. With no secret configured this
 * provider does not exist, and neither does the risk it carries.
 */
export class BotIdentityProvider implements IdentityProvider {
  readonly id = "bot";

  constructor(private readonly secret: string) {
    // Fail on boot, not at the moment somebody tries to pay a friend.
    assertUsableBotSecret(secret);
  }

  async verify(token: string): Promise<VerifiedIdentity[]> {
    try {
      const claim = await verifyBotToken(token, this.secret);
      return [
        {
          provider: claim.platform,
          subject: claim.subject,
          username: claim.username,
          // The platform said they wrote a message. It did not say they are
          // here proving they own the account, and the difference is what stops
          // a leaked bot secret from claiming anybody's waiting money.
          attestation: "authorship",
        },
      ];
    } catch (error) {
      // Rethrown in the shape every provider uses, so a bot token and a Privy
      // token fail the same way and the caller learns nothing from which.
      if (error instanceof BotTokenError) {
        throw new IdentityVerificationError(error.message);
      }
      throw error;
    }
  }

  // Deliberately no walletAddress. Privy holds the keys; a bot never provisions
  // a wallet, because provisioning one is how a leaked secret would turn into a
  // brand-new account nobody asked for.
}
