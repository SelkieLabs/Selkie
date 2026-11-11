/**
 * NEAR Intents through the 1Click API: dollars in from other chains, out to them.
 *
 *   in:  USDT on Tron (say) -> 1Click deposit address -> USDC in your NEAR account
 *   out: USDC in your NEAR account -> ft_transfer to a 1Click deposit address
 *        (signed by you, relayed like any payment) -> USDC on Base (say)
 *
 * Asset ids always come from GET /v0/tokens, never from memory. 1Click runs on
 * mainnet only and refuses `.testnet` accounts, so a testnet build can show a
 * dry quote (real prices, real timing) with a stand-in mainnet account and can
 * never ask for a deposit address.
 *
 * Checked live against https://1click.chaindefuser.com on 11 Nov 2026: tokens
 * carry assetId/decimals/blockchain/symbol/contractAddress; a quote is
 * `{ quote: { amountIn, amountOut, ... } }` or `{ message }`; `.testnet`
 * recipients answer 500; some routes have temporary minimums ("minimum swap
 * amount is $100" for Tron USDT in).
 */
import { AmountError, toPositiveBaseUnits } from "./amounts";

export type IntentsDirection = "in" | "out";

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: string;
  contractAddress?: string;
}

/** An asset someone can bring in or take out, as the web app shows it. */
export interface ChainAsset {
  assetId: string;
  symbol: string;
  blockchain: string;
  chainName: string;
  decimals: number;
}

export interface OneClickQuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  deadline: string;
  referral: string;
}

export interface OneClickQuote {
  depositAddress?: string;
  depositMemo?: string | null;
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  minAmountOut?: string;
  deadline?: string | null;
  timeEstimate?: number;
}

export type OneClickStatusName =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED";

export const TERMINAL_STATUSES: readonly OneClickStatusName[] = ["SUCCESS", "INCOMPLETE_DEPOSIT", "REFUNDED", "FAILED"];

export interface OneClickStatus {
  status: OneClickStatusName;
  updatedAt?: string;
  swapDetails?: {
    amountInFormatted?: string;
    amountOutFormatted?: string;
    originChainTxHashes?: { hash: string; explorerUrl: string }[];
    destinationChainTxHashes?: { hash: string; explorerUrl: string }[];
    refundedAmount?: string;
    refundReason?: string;
  };
}

/** Something 1Click said no to, in words fit to show. `status` is 1Click's HTTP status. */
export class IntentsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * The chains Selkie offers, by 1Click's `blockchain` name. Stablecoins only:
 * Selkie is dollars, and a dollar in should read as a dollar out. Stellar is
 * left out because its deposits need a memo, and a forgotten memo loses money.
 */
const CHAIN_NAMES: Record<string, string> = {
  base: "Base",
  arb: "Arbitrum",
  eth: "Ethereum",
  sol: "Solana",
  tron: "Tron",
  bsc: "BNB Chain",
  pol: "Polygon",
  op: "Optimism",
  avax: "Avalanche",
  ton: "TON",
};
const STABLES = new Set(["USDC", "USDT"]);

/** What the web app offers: stablecoins on the chains above, in that order. */
export function chainAssets(tokens: OneClickToken[]): ChainAsset[] {
  const order = Object.keys(CHAIN_NAMES);
  return tokens
    .filter((token) => CHAIN_NAMES[token.blockchain] && STABLES.has(token.symbol))
    .map((token) => ({
      assetId: token.assetId,
      symbol: token.symbol,
      blockchain: token.blockchain,
      chainName: CHAIN_NAMES[token.blockchain]!,
      decimals: token.decimals,
    }))
    .sort((a, b) => order.indexOf(a.blockchain) - order.indexOf(b.blockchain) || a.symbol.localeCompare(b.symbol));
}

/**
 * USDC on NEAR as 1Click knows it. On mainnet, the token whose contract is the
 * one Selkie holds. On testnet there is none, so previews price against
 * mainnet USDC, which is what a testnet balance stands in for.
 */
export function nearUsdc(tokens: OneClickToken[], usdcContract: string, network: "testnet" | "mainnet"): OneClickToken | null {
  const near = tokens.filter((token) => token.blockchain === "near" && token.symbol === "USDC");
  const exact = near.find((token) => token.contractAddress === usdcContract);
  // On mainnet only the exact contract will do: a lookalike would quote a
  // token Selkie does not hold.
  if (exact || network === "mainnet") return exact ?? null;
  return near[0] ?? null;
}

/**
 * A mainnet account that stands in for a testnet one in previews. 1Click
 * answers 500 for `.testnet` names; `intents.near` (the Intents contract) was
 * accepted as a recipient when checked. Dry quotes only: no deposit address is
 * ever made for it.
 */
export const PREVIEW_ACCOUNT = "intents.near";

/** 1% either way. Stablecoin routes rarely move that much; anything worse should refund, not fill. */
export const SLIPPAGE_BPS = 100;
/** How long a quote's deposit address stays good. 1Click's default is about ten minutes. */
export const QUOTE_DEADLINE_MS = 10 * 60_000;

/**
 * The quote request for one move. The amount is in the asset being deposited:
 * the other chain's coin coming in, USDC on NEAR going out.
 */
export function quoteRequest(input: {
  direction: IntentsDirection;
  asset: ChainAsset;
  usdc: OneClickToken;
  amount: string;
  /** The person's NEAR account: where money in lands, where a failed cash-out is refunded. */
  nearAccount: string;
  /** On the other chain: where money out goes, where failed money in is refunded. */
  externalAddress: string;
  dry: boolean;
  now: number;
}): OneClickQuoteRequest {
  const incoming = input.direction === "in";
  const decimals = incoming ? input.asset.decimals : input.usdc.decimals;
  let units: bigint;
  try {
    units = toPositiveBaseUnits(input.amount, decimals);
  } catch (error) {
    throw new IntentsError(error instanceof AmountError ? error.message : "Enter an amount.", 400);
  }
  const external = input.externalAddress.trim();
  if (!external) throw new IntentsError(incoming ? "Add an address to refund to." : "Add the address to send to.", 400);
  return {
    dry: input.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: SLIPPAGE_BPS,
    originAsset: incoming ? input.asset.assetId : input.usdc.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: incoming ? input.usdc.assetId : input.asset.assetId,
    amount: units.toString(),
    refundTo: incoming ? external : input.nearAccount,
    refundType: "ORIGIN_CHAIN",
    recipient: incoming ? input.nearAccount : external,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(input.now + QUOTE_DEADLINE_MS).toISOString(),
    referral: "selkie",
  };
}

const TOKENS_TTL_MS = 5 * 60_000;

export class OneClickClient {
  #tokens: { at: number; list: OneClickToken[] } | null = null;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(
    private readonly options: { baseUrl: string; jwt?: string; fetch?: typeof fetch; now?: () => number },
  ) {
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  /** The token list, cached: it changes rarely and every quote needs it. */
  async tokens(): Promise<OneClickToken[]> {
    if (this.#tokens && this.#now() - this.#tokens.at < TOKENS_TTL_MS) return this.#tokens.list;
    const list = await this.#call<OneClickToken[]>("GET", "/v0/tokens");
    if (!Array.isArray(list)) throw new IntentsError("1Click sent an unexpected token list.", 502);
    this.#tokens = { at: this.#now(), list };
    return list;
  }

  async quote(request: OneClickQuoteRequest): Promise<OneClickQuote> {
    const body = await this.#call<{ quote?: OneClickQuote }>("POST", "/v0/quote", request);
    if (!body.quote || typeof body.quote.amountOut !== "string") throw new IntentsError("1Click sent no quote.", 502);
    if (!request.dry && !body.quote.depositAddress) throw new IntentsError("1Click sent no deposit address.", 502);
    return body.quote;
  }

  async status(depositAddress: string): Promise<OneClickStatus> {
    return this.#call<OneClickStatus>("GET", `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`);
  }

  /** Tells 1Click a deposit was sent, which speeds it up. Optional for 1Click, so never fatal here. */
  async submitDeposit(input: { txHash: string; depositAddress: string; nearSenderAccount: string }): Promise<void> {
    await this.#call("POST", "/v0/deposit/submit", input);
  }

  async #call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.options.jwt) headers.authorization = `Bearer ${this.options.jwt}`;
    let response: Response;
    try {
      response = await this.#fetch(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new IntentsError("Could not reach NEAR Intents. Try again in a moment.", 503);
    }
    const parsed = (await response.json().catch(() => null)) as (T & { message?: unknown }) | null;
    if (!response.ok) throw new IntentsError(errorWords(response.status, parsed?.message), response.status);
    if (parsed === null) throw new IntentsError("NEAR Intents sent an empty answer.", 502);
    return parsed;
  }
}

/** 1Click's own words when they are about the request; a plain line when they are about 1Click. */
function errorWords(status: number, message: unknown): string {
  const said = typeof message === "string" ? message : "";
  if (/refundTo is not valid/i.test(said)) return "That refund address doesn't look right for that chain.";
  if (/recipient is not valid/i.test(said)) return "That address doesn't look right for that chain.";
  if (status >= 500 || !said) return "NEAR Intents could not quote that route just now. Try another chain or amount.";
  return said;
}
