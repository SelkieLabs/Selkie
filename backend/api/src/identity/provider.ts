import type { IdentityProviderId, VerifiedIdentity } from "./types";

/**
 * Turns "the user says they are @amaka" into "the provider confirms they are".
 *
 * Everything in Selkie's security model reduces to this: escrowed money is
 * released because a provider vouched that this person controls that handle. So
 * verification is an interface with exactly one honest implementation at a time,
 * and a fake one for tests that is impossible to enable by accident.
 */
export interface IdentityProvider {
  readonly id: string;
  /** Verify a login token from the client. Throws if it is not genuine. */
  verify(token: string): Promise<VerifiedIdentity[]>;
  /** The wallet address the provider holds for this user, if it manages keys. */
  walletAddress?(token: string): Promise<string | null>;
}

export class IdentityVerificationError extends Error {}

/**
 * Test double. Accepts tokens of the form
 * `test:<provider>:<subject>:<username>` and nothing else.
 *
 * It refuses to construct unless explicitly allowed, so it cannot be switched on
 * in production by a stray environment variable.
 */
export class FakeIdentityProvider implements IdentityProvider {
  readonly id = "fake";

  constructor(allowInsecure: boolean) {
    if (!allowInsecure) {
      throw new Error("FakeIdentityProvider must never be used outside tests");
    }
  }

  async verify(token: string): Promise<VerifiedIdentity[]> {
    const parts = token.split(":");
    if (parts.length !== 4 || parts[0] !== "test") {
      throw new IdentityVerificationError("Not a test token");
    }
    const [, provider, subject, username] = parts as [string, IdentityProviderId, string, string];
    return [
      {
        provider,
        subject,
        username: username || undefined,
        displayName: username || undefined,
      },
    ];
  }
}
