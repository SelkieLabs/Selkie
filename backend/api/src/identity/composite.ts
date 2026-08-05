import { IdentityVerificationError } from "./provider";
import type { IdentityProvider } from "./provider";
import type { VerifiedIdentity } from "./types";

/**
 * One API, several kinds of caller.
 *
 * The web app sends a Privy token. The X worker sends a bot token. Both are
 * asking the same question of the same routes, so rather than branching on the
 * caller inside every handler, the providers are tried in turn and the first one
 * that recognises the token wins. A route never learns which it was, which is
 * how the bot and the web app stay guaranteed to behave identically.
 *
 * Order is by cost: cheap local checks before a network round trip.
 */
export class CompositeIdentityProvider implements IdentityProvider {
  readonly id: string;

  constructor(private readonly providers: IdentityProvider[]) {
    if (providers.length === 0) {
      throw new Error("An API with no identity provider can verify nobody.");
    }
    this.id = providers.map((provider) => provider.id).join("+");
  }

  async verify(token: string): Promise<VerifiedIdentity[]> {
    const found = await this.#recognize(token);
    if (!found) {
      // Never says which provider rejected it or why. A caller probing with
      // made-up tokens should not be able to map out what we accept.
      throw new IdentityVerificationError("That sign-in could not be verified.");
    }
    return found.identities;
  }

  /**
   * Ask the provider that actually issued the token, and nobody else.
   *
   * Asking each in turn instead would let a bot token reach Privy's wallet
   * lookup, and a provider answering a question about a token it never issued is
   * the kind of confusion that ends with money in the wrong account.
   */
  async walletAddress(token: string): Promise<string | null> {
    const found = await this.#recognize(token);
    if (!found?.provider.walletAddress) return null;
    return found.provider.walletAddress(token);
  }

  async #recognize(
    token: string,
  ): Promise<{ provider: IdentityProvider; identities: VerifiedIdentity[] } | null> {
    for (const provider of this.providers) {
      try {
        const identities = await provider.verify(token);
        if (identities.length > 0) return { provider, identities };
      } catch (error) {
        // A provider saying "not mine" is the normal case with more than one in
        // play. Anything else is a real fault, and swallowing it would turn an
        // outage at Privy into "your password is wrong" for every user at once.
        if (error instanceof IdentityVerificationError) continue;
        throw error;
      }
    }
    return null;
  }
}
