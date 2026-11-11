import type { Account, Balance, ChainId, HandleRef, Money, PaymentResult, TxResult } from "./types";

/** What a chain can do, so surfaces can show or hide features per chain. */
export interface ChainCapabilities {
  /** Money can be sent to a handle that has no account yet, and claimed later. */
  claimableSends: boolean;
  /** Fees are sponsored, so users never hold the gas token. */
  gasless: boolean;
  /** This adapter is wired to on/off-ramp providers. */
  ramp: boolean;
}

/**
 * A ChainAdapter is the ONLY place chain-specific code lives. The rest of the
 * product talks to this interface, never to a chain SDK. Adding a new chain
 * means writing one of these and registering it. Nothing else moves.
 */
export interface ChainAdapter {
  readonly id: ChainId;
  readonly capabilities: ChainCapabilities;

  /** Find or create the account a handle owns. Must not throw for a brand-new handle. */
  ensureAccount(handle: HandleRef): Promise<Account>;

  /** Current balances for an account. */
  getBalance(account: Account): Promise<Balance>;

  /**
   * Send money from one handle to another. The adapter settles directly when the
   * recipient already has an account, and otherwise holds the funds for a later
   * claim (see capabilities.claimableSends). Callers do not need to know which
   * path ran; the result says so via `heldForClaim`.
   */
  send(from: HandleRef, to: HandleRef, amount: Money, memo?: string): Promise<PaymentResult>;

  /** Claim funds that were sent to a handle before it had an account. */
  claim(handle: HandleRef): Promise<TxResult>;
}
