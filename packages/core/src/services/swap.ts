import type { Account, Money } from "../chains/types";

// Swapping one asset for another (e.g. USDC to a local stablecoin, or to XLM).
// The venue behind it (an on-chain DEX, an aggregator) is a provider detail.

export interface SwapQuote {
  provider: string;
  from: Money;
  to: Money;
}

export interface SwapProvider {
  readonly id: string;
  quote(from: Money, toAsset: string): Promise<SwapQuote>;
  swap(account: Account, from: Money, toAsset: string): Promise<{ ref: string }>;
}
