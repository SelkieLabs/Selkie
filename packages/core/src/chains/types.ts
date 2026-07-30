// Chain-agnostic money and identity types. These describe WHAT Selkie moves.
// HOW it moves on a given chain is a chain adapter's job (see adapter.ts).

/** Which chain an account lives on. Add a value when you add an adapter. */
export type ChainId = "stellar" | "canton" | (string & {});

/** The social identity that IS the account. No addresses in the product layer. */
export interface HandleRef {
  platform: "x" | "telegram" | "email" | (string & {});
  /** Normalized username: no leading @, lowercased. */
  username: string;
}

/** A money amount, always as a decimal string so we never lose cents to floats. */
export interface Money {
  /** Decimal string, e.g. "10.50". */
  amount: string;
  /** Asset code, e.g. "USDC". */
  asset: string;
}

/** An account on some chain, owned by a handle. `address` is opaque to the app. */
export interface Account {
  chain: ChainId;
  handle: HandleRef;
  address: string;
  /** `unclaimed` = money is waiting but the handle has not signed in yet. */
  status: "active" | "unclaimed" | "provisioning";
}

export interface Balance {
  account: Account;
  balances: Money[];
}

export type TxStatus = "pending" | "confirmed" | "failed" | "timeout";

export interface TxResult {
  status: TxStatus;
  /** Chain-native tx/operation id, when known. */
  ref?: string;
  /** Human-safe message, when failed or timed out. */
  error?: string;
}

/** Result of a payment: settled to an account, or set aside to be claimed. */
export interface PaymentResult extends TxResult {
  /** True when the recipient had no account and the money is waiting to be claimed. */
  heldForClaim: boolean;
  claimRef?: string;
}
