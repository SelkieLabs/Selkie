import type { Account, Money } from "../chains/types";

// Turning digital dollars into local cash and back (anchors, card, mobile money).
// A provider is anything that can quote and run that swap. Swapping providers, or
// running several per country, never touches the rest of the app.

export interface RampQuote {
  provider: string;
  give: Money;
  get: Money;
  /** Human-safe note about fees or rate, when the provider gives one. */
  note?: string;
}

export interface RampHandoff {
  /** A URL the user completes (e.g. an interactive anchor flow), when needed. */
  url?: string;
  /** Reference to poll for status. */
  ref: string;
}

export interface RampProvider {
  readonly id: string;
  quoteOnRamp(fiat: Money): Promise<RampQuote>;
  quoteOffRamp(crypto: Money): Promise<RampQuote>;
  startOnRamp(account: Account, fiat: Money): Promise<RampHandoff>;
  startOffRamp(account: Account, crypto: Money): Promise<RampHandoff>;
  status(ref: string): Promise<"pending" | "completed" | "failed">;
}
