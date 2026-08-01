import { createHash } from "node:crypto";
import type { IdentityProvider } from "./identity/provider";
import type { VerifiedIdentity } from "./identity/types";

/**
 * Selkie issues no session tokens of its own.
 *
 * The client holds the identity provider's access token and sends it on every
 * request; we ask the provider whether it is genuine. Rolling our own session
 * format would be one more thing to get wrong, and auth bugs are how money apps
 * actually get robbed. The tradeoff is a verification call per request, which a
 * short cache absorbs.
 *
 * Production note: Privy access tokens are JWTs that can be verified offline
 * against their JWKS. That is a drop-in change behind this class when the call
 * volume justifies it, and it removes the cache entirely.
 */
export class TokenVerifier {
  readonly #cache = new Map<string, { identities: VerifiedIdentity[]; expiresAt: number }>();

  constructor(
    private readonly provider: IdentityProvider,
    private readonly ttlMs = 60_000,
  ) {}

  async verify(token: string): Promise<VerifiedIdentity[]> {
    const key = fingerprint(token);
    const cached = this.#cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.identities;

    const identities = await this.provider.verify(token);
    this.#cache.set(key, { identities, expiresAt: Date.now() + this.ttlMs });
    return identities;
  }

  /** Drop a token immediately, for logout or a revoked session. */
  forget(token: string): void {
    this.#cache.delete(fingerprint(token));
  }
}

/**
 * Tokens are cached and logged by fingerprint, never by value. A log file full
 * of live bearer tokens is a breach waiting for someone to read it.
 */
export function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value;
}
