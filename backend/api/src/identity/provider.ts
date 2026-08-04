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
  /**
   * Who this token belongs to, proved without asking anybody.
   *
   * The provider's own permanent id for this person, established from the
   * token's signature alone. This is the one that runs on **every** request, so
   * it must not touch the network: an identity provider having a bad ten minutes
   * should not stop people reading their own balance.
   *
   * Throws for anything that is not a live, correctly signed token.
   */
  subjectOf(token: string): Promise<string>;
  /**
   * Every identity the provider has confirmed for this person.
   *
   * Costs a round trip, and is only worth paying on the deliberate acts: signing
   * in, and linking a new account.
   */
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

  /**
   * The fake's stand-in for a provider account id.
   *
   * Two logins by the same human come back as two different ids here, which is
   * exactly the case the real thing produces when somebody signs up twice
   * before linking, and exactly what merging has to survive.
   */
  async subjectOf(token: string): Promise<string> {
    const [, provider, subject] = this.#parse(token);
    return `fake:${provider}:${subject}`;
  }

  async verify(token: string): Promise<VerifiedIdentity[]> {
    const [, provider, subject, username] = this.#parse(token);
    return [
      {
        provider,
        subject,
        username: username || undefined,
        displayName: username || undefined,
      },
    ];
  }

  #parse(token: string): [string, IdentityProviderId, string, string] {
    const parts = token.split(":");
    if (parts.length !== 4 || parts[0] !== "test") {
      throw new IdentityVerificationError("Not a test token");
    }
    return parts as [string, IdentityProviderId, string, string];
  }
}
