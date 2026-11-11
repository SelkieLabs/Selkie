import type { Account, Balance, HandleRef, Money } from "@selkie/core";
import type { User, VerifiedIdentity } from "./types";

/**
 * The slice of a chain that the account model needs, and nothing more.
 *
 * IdentityService was written against the Stellar adapter, which signs for its
 * users. This is the same set of calls with the chain left open, so the Stellar
 * adapter satisfies it unchanged and NEAR — where the user's own key signs and
 * Selkie only creates the account and releases escrow — can supply its own.
 *
 * The `owner` argument on the claim calls is there for chains that hold money
 * for more than the handle's text (NEAR also waits on the X user id); Stellar
 * ignores it.
 */
export interface IdentityChain {
  isReceivable(address: string): Promise<boolean>;
  ensureReceivable(address: string): Promise<unknown>;
  ensureAccount(handle: HandleRef): Promise<{ address: string }>;
  pendingClaims(handle: HandleRef, owner: User): Promise<readonly unknown[]>;
  waitingFor(handle: HandleRef, owner: User): Promise<Money[]>;
  claim(handle: HandleRef, owner: User): Promise<{ ref?: string }>;
  getBalance(account: Account): Promise<Balance>;
  transfer(params: { fromAddress: string; toAddress: string; amount: Money }): Promise<unknown>;
  /**
   * Open the account a brand-new user signs up with, when the chain needs more
   * than a handle to do it. On NEAR that is the user's own public key, which the
   * identity provider holds (`providerWallet`), so Selkie never generates one.
   * Chains without it fall back to the provider's wallet or `ensureAccount`.
   */
  openAccount?(input: { identities: VerifiedIdentity[]; providerWallet: string | null }): Promise<string>;
}
