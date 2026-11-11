import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
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
 *
 * ## How a login is actually checked
 *
 * The access token is an ES256 JWT. Selkie verifies it against the app's public
 * key and then looks the user up by the subject it carries. There is no endpoint
 * that trades a user token for a user; asking Privy "who is this token" is not a
 * thing you can do, and a token that is merely *shaped* right proves nothing.
 *
 * Verification is deliberately strict, because this is the one check standing
 * between a stranger and someone else's money:
 *
 *  - the algorithm must be ES256, read from our own expectations and never from
 *    the token's own header, which is how `alg: none` attacks work
 *  - the issuer must be Privy and the audience must be this exact app, so a
 *    valid token minted for a different app is still refused here
 *  - expiry is checked, with no grace period
 */
export interface PrivyConfig {
  appId: string;
  appSecret: string;
  /** Overridable so tests can point at a local stub. */
  apiUrl?: string;
  /**
   * The app's token-signing public key, in PEM. Fetched from Privy at first use
   * when not supplied, which keeps it in exactly one place: their dashboard.
   */
  verificationKey?: string;
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

const PRIVY_ISSUER = "privy.io";

export class PrivyIdentityProvider implements IdentityProvider {
  readonly id = "privy";
  readonly #apiUrl: string;
  readonly #authorization: string;
  #key: KeyObject | null = null;

  constructor(private readonly config: PrivyConfig) {
    if (!config.appId || !config.appSecret) {
      throw new Error("Privy needs both an app id and an app secret");
    }
    this.#apiUrl = config.apiUrl ?? "https://auth.privy.io";
    this.#authorization = `Basic ${Buffer.from(`${config.appId}:${config.appSecret}`).toString("base64")}`;
    if (config.verificationKey) this.#key = toPublicKey(config.verificationKey);
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
        // Privy only answers for a token the person signed in with, so this is
        // proof of ownership and may create a wallet or claim a handle.
        attestation: "login",
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

  /**
   * Who this token says they are, proved rather than taken on trust.
   *
   * Returns the Privy user id (a DID). Throws for anything that is not a live,
   * correctly signed token issued to this app.
   */
  async subjectOf(token: string): Promise<string> {
    const parts = token.split(".");
    if (parts.length !== 3) throw rejected(token, "not a token");
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

    const header = decodeSegment(token, encodedHeader);
    // Read from what we require, never from what the token claims. A token that
    // gets to pick its own algorithm can pick one that needs no key.
    if (header.alg !== "ES256") throw rejected(token, "unexpected signing algorithm");

    const key = await this.#verificationKey(token);
    const signed = Buffer.from(`${encodedHeader}.${encodedPayload}`);
    const signature = Buffer.from(encodedSignature, "base64url");
    // JWS carries the raw r||s pair, not the DER encoding node defaults to.
    const ok = verifySignature("sha256", signed, { key, dsaEncoding: "ieee-p1363" }, signature);
    if (!ok) throw rejected(token, "signature does not match");

    const payload = decodeSegment(token, encodedPayload);
    if (payload.iss !== PRIVY_ISSUER) throw rejected(token, "wrong issuer");

    // A perfectly valid token minted for someone else's Privy app is still not
    // a login here.
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audience.includes(this.config.appId)) throw rejected(token, "wrong audience");

    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
      throw rejected(token, "expired");
    }
    if (typeof payload.sub !== "string" || !payload.sub) throw rejected(token, "no subject");

    return payload.sub;
  }

  /** The app's signing key, fetched once and kept. */
  async #verificationKey(token: string): Promise<KeyObject> {
    if (this.#key) return this.#key;

    const response = await fetch(`${this.#apiUrl}/api/v1/apps/${this.config.appId}`, {
      headers: {
        authorization: this.#authorization,
        "privy-app-id": this.config.appId,
      },
    });
    if (!response.ok) {
      throw rejected(token, `Privy would not give us the signing key (${response.status})`);
    }

    const app = (await response.json()) as { verification_key?: string };
    if (!app.verification_key) throw rejected(token, "Privy has no signing key for this app");

    this.#key = toPublicKey(app.verification_key);
    return this.#key;
  }

  async #fetchUser(token: string): Promise<PrivyUserResponse> {
    const subject = await this.subjectOf(token);

    // App credentials, because this call is Selkie asking about a user it has
    // already proved is real. The user's own token never leaves this process.
    const response = await fetch(`${this.#apiUrl}/api/v1/users/${encodeURIComponent(subject)}`, {
      headers: {
        authorization: this.#authorization,
        "privy-app-id": this.config.appId,
      },
    });

    if (!response.ok) {
      throw rejected(token, `Privy rejected the lookup (${response.status})`);
    }
    return (await response.json()) as PrivyUserResponse;
  }
}

/**
 * Privy hands the key back as one long line. PEM wants 64-character lines, and
 * node is strict about it.
 */
function toPublicKey(pem: string): KeyObject {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return createPublicKey(`-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----\n`);
}

function decodeSegment(token: string, segment: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw rejected(token, "unreadable");
  }
}

/**
 * One place that builds the rejection, so a failure is traceable in a log
 * without the token ever appearing in one.
 */
function rejected(token: string, reason: string): IdentityVerificationError {
  return new IdentityVerificationError(`Login rejected (${reason}) for token ${fingerprint(token)}`);
}

/** A short, non-reversible tag so failures are traceable without leaking a token. */
function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 8);
}
