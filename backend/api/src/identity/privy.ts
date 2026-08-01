import { createHash } from "node:crypto";
import type { IdentityProvider } from "./provider";
import { IdentityVerificationError } from "./provider";
import type { IdentityProviderId, VerifiedIdentity } from "./types";

/**
 * Privy as Selkie's identity and wallet provider.
 *
 * Why Privy: it is the only major embedded-wallet provider that covers all three
 * of our identity types (Google, X, Telegram) AND issues Stellar wallets, which
 * matters because Stellar is ed25519 and most providers are EVM-first. Keys sit
 * in a TEE with Shamir's Secret Sharing rather than in our database, so Selkie
 * never holds a user's private key.
 *
 * What we take from Privy: proof of who someone is, and a wallet address.
 * What we keep: everything about what that means. Privy does not know that
 * linking an X account releases escrowed money; that logic is ours, and it stays
 * behind the IdentityProvider interface so Privy can be replaced.
 */
export interface PrivyConfig {
  appId: string;
  appSecret: string;
  /** Overridable so tests can point at a local stub. */
  apiUrl?: string;
}

interface PrivyLinkedAccount {
  type: string;
  subject?: string;
  username?: string;
  name?: string;
  email?: string;
  address?: string;
  chain_type?: string;
  profile_picture_url?: string;
  telegram_user_id?: string;
  first_name?: string;
}

interface PrivyUserResponse {
  id: string;
  linked_accounts?: PrivyLinkedAccount[];
}

/** Privy's account types mapped onto ours. Anything else is ignored. */
const PROVIDER_BY_PRIVY_TYPE: Record<string, IdentityProviderId> = {
  google_oauth: "google",
  twitter_oauth: "x",
  telegram: "telegram",
};

export class PrivyIdentityProvider implements IdentityProvider {
  readonly id = "privy";
  readonly #apiUrl: string;
  readonly #authorization: string;

  constructor(private readonly config: PrivyConfig) {
    if (!config.appId || !config.appSecret) {
      throw new Error("Privy needs both an app id and an app secret");
    }
    this.#apiUrl = config.apiUrl ?? "https://auth.privy.io";
    this.#authorization = `Basic ${Buffer.from(`${config.appId}:${config.appSecret}`).toString("base64")}`;
  }

  /**
   * Verify an access token and return every identity Privy has confirmed for
   * this person. Privy returns the whole linked-account list, which is exactly
   * the shape Selkie's account model wants.
   */
  async verify(token: string): Promise<VerifiedIdentity[]> {
    const user = await this.#fetchUser(token);
    const identities: VerifiedIdentity[] = [];

    for (const account of user.linked_accounts ?? []) {
      const provider = PROVIDER_BY_PRIVY_TYPE[account.type];
      if (!provider) continue;

      // The permanent id, never the username. Handles get renamed and
      // re-registered; keying on the string would eventually hand someone
      // else's money to a stranger.
      const subject = account.subject ?? account.telegram_user_id;
      if (!subject) continue;

      identities.push({
        provider,
        subject,
        username: account.username ?? undefined,
        displayName: account.name ?? account.first_name ?? undefined,
        avatarUrl: account.profile_picture_url ?? undefined,
        email: account.email ?? undefined,
      });
    }

    if (identities.length === 0) {
      throw new IdentityVerificationError("Privy returned no identities Selkie can use");
    }
    return identities;
  }

  /** The Stellar wallet Privy holds for this user, if one has been created. */
  async walletAddress(token: string): Promise<string | null> {
    const user = await this.#fetchUser(token);
    const wallet = (user.linked_accounts ?? []).find(
      (account) => account.type === "wallet" && account.chain_type === "stellar",
    );
    return wallet?.address ?? null;
  }

  async #fetchUser(token: string): Promise<PrivyUserResponse> {
    const response = await fetch(`${this.#apiUrl}/api/v1/users/me`, {
      headers: {
        authorization: `Bearer ${token}`,
        "privy-app-id": this.config.appId,
        // App credentials authenticate Selkie itself, so a stolen user token
        // alone is not enough to query Privy as us.
        "privy-authorization": this.#authorization,
      },
    });

    if (!response.ok) {
      // Never echo the token back, not even hashed into a log message.
      throw new IdentityVerificationError(
        `Privy rejected the login (${response.status}) for token ${fingerprint(token)}`,
      );
    }
    return (await response.json()) as PrivyUserResponse;
  }
}

/** A short, non-reversible tag so failures are traceable without leaking a token. */
function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 8);
}
