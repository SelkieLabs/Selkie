import type {
  Account,
  Balance,
  ChainAdapter,
  ChainCapabilities,
  HandleRef,
  Money,
  PaymentResult,
  TxResult,
} from "@selkie/core";

/**
 * Stellar implementation of ChainAdapter. This is the ONLY place Stellar-specific
 * code lives; the rest of Selkie never imports a Stellar SDK.
 *
 * How Selkie's model maps onto Stellar (see docs/selkie-stellar-product-scope.md):
 *  - ensureAccount: provision an embedded wallet bound to the handle (Privy or a
 *    passkey), and sponsor the account reserve + USDC trustline so the user needs
 *    no XLM of their own.
 *  - send to an existing account: a direct USDC payment, fee-bumped so it is gasless.
 *  - send to a handle with no account yet: a Claimable Balance locked to that handle,
 *    which is what lets you pay someone who has never touched Selkie.
 *  - claim: the handle owner signs in, we release the claimable balance and sponsor
 *    their account setup.
 */
export interface StellarConfig {
  horizonUrl: string;
  networkPassphrase: string;
  /** Issuer account of the USDC asset used for balances and payments. */
  usdcIssuer: string;
}

const notImplemented = (method: string): never => {
  throw new Error(`StellarAdapter.${method} is not implemented yet`);
};

export class StellarAdapter implements ChainAdapter {
  readonly id = "stellar" as const;
  readonly capabilities: ChainCapabilities = {
    claimableSends: true,
    gasless: true,
    ramp: true,
  };

  constructor(private readonly config: StellarConfig) {}

  async ensureAccount(_handle: HandleRef): Promise<Account> {
    return notImplemented("ensureAccount");
  }

  async getBalance(_account: Account): Promise<Balance> {
    return notImplemented("getBalance");
  }

  async send(_from: HandleRef, _to: HandleRef, _amount: Money, _memo?: string): Promise<PaymentResult> {
    return notImplemented("send");
  }

  async claim(_handle: HandleRef): Promise<TxResult> {
    return notImplemented("claim");
  }
}
