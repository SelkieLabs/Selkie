/**
 * NEAR Intents for the web app: add money from another chain, cash out to one.
 *
 * The 1Click JWT stays here. The browser says what it wants in its own terms
 * (this asset, this amount, this address) and gets back what to do; it never
 * builds a 1Click request or sees the key.
 *
 * Testnet can only preview. 1Click is mainnet only and refuses `.testnet`
 * accounts, so previews quote against a stand-in mainnet account, are always
 * dry, and are labelled. Nothing on testnet ever gets a deposit address.
 *
 * Cash-out never gets its deposit address from these routes: prepare asks for
 * it at the moment the person confirms (payments.ts), so the transfer they
 * sign is built from a live quote on the server, not from anything the
 * browser sent back.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  IntentsError,
  PREVIEW_ACCOUNT,
  TERMINAL_STATUSES,
  chainAssets,
  exactOutputRequest,
  fromBaseUnits,
  nearUsdc,
  quoteRequest,
  type ChainAsset,
  type IntentsDirection,
  type NearPublicConfig,
  type OneClickClient,
  type OneClickQuote,
  type OneClickToken,
} from "@selkie/chain-near";
import type { User } from "../identity/types";
import { Refusal } from "./refusal";

export const MAINNET_ONLY =
  "Moving money between chains runs on NEAR mainnet. This is the testnet version, so you can see a live quote but nothing moves.";

/** What the web app shows for a quote. Amounts are 1Click's own formatted strings. */
export interface QuoteView {
  direction: IntentsDirection;
  /** True on testnet: a real price, but nothing can be deposited. */
  preview: boolean;
  asset: ChainAsset;
  amountIn: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  /** The least that will arrive after slippage, formatted. */
  minAmountOutFormatted?: string;
  /** Seconds, 1Click's estimate. */
  timeEstimate?: number;
  depositAddress?: string;
  deadline?: string;
}

export class IntentsDesk {
  constructor(
    private readonly client: OneClickClient,
    private readonly config: NearPublicConfig,
  ) {}

  get live(): boolean {
    return this.config.network === "mainnet";
  }

  async assets(): Promise<ChainAsset[]> {
    return chainAssets(await this.client.tokens());
  }

  /**
   * A quote for this person. Dry unless `commit` is set, on mainnet, for money
   * coming in: that one returns the address they send to from the other chain.
   */
  async quote(
    user: User,
    input: { direction: IntentsDirection; assetId: string; amount: string; address: string; commit?: boolean },
  ): Promise<QuoteView> {
    if (input.direction !== "in" && input.direction !== "out") throw new Refusal(400, "Choose money in or money out.");
    if (input.commit && !this.live) throw new Refusal(409, MAINNET_ONLY);
    if (input.commit && input.direction === "out") {
      throw new Refusal(400, "A cash-out gets its deposit address when you confirm it.");
    }
    return this.#quote(user, { ...input, dry: !input.commit });
  }

  /** The committed quote a cash-out is built from. Mainnet only. */
  async cashOutQuote(user: User, input: { assetId: string; amount: string; address: string }): Promise<QuoteView & { depositAddress: string }> {
    if (!this.live) throw new Refusal(409, MAINNET_ONLY);
    const view = await this.#quote(user, { ...input, direction: "out", dry: false });
    if (!view.depositAddress) throw new Refusal(502, "NEAR Intents sent no deposit address. Nothing moved. Try again.");
    return { ...view, depositAddress: view.depositAddress };
  }

  async status(depositAddress: string) {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(depositAddress)) throw new Refusal(400, "That is not a deposit address.");
    const status = await this.client.status(depositAddress);
    const details = status.swapDetails ?? {};
    return {
      status: status.status,
      done: TERMINAL_STATUSES.includes(status.status),
      amountInFormatted: details.amountInFormatted,
      amountOutFormatted: details.amountOutFormatted,
      refundReason: details.refundReason,
      originTxs: (details.originChainTxHashes ?? []).map((tx) => tx.explorerUrl).filter(Boolean),
      destinationTxs: (details.destinationChainTxHashes ?? []).map((tx) => tx.explorerUrl).filter(Boolean),
    };
  }

  /**
   * USDC on another chain (by 1Click's chain name) and Selkie's USDC on NEAR,
   * as 1Click lists them. Exactly one USDC on that chain, or none: a lookalike
   * would pay out a token nobody asked for.
   */
  async usdcOn(blockchain: string): Promise<{ asset: OneClickToken; usdc: OneClickToken }> {
    const tokens = await this.client.tokens();
    const usdc = nearUsdc(tokens, this.config.usdcContract, this.config.network);
    if (!usdc) throw new Refusal(503, "NEAR Intents does not list Selkie's USDC right now. Try again later.");
    const matches = tokens.filter((token) => token.blockchain === blockchain && token.symbol === "USDC");
    if (matches.length !== 1) throw new Refusal(503, "NEAR Intents does not list one clear USDC on that chain right now.");
    return { asset: matches[0]!, usdc };
  }

  /**
   * A quote that lands exactly `amountOut` (base units of `asset`) at
   * `recipient`, for paying something with a set price. Committed quotes are
   * mainnet only and refund to the person's own NEAR account.
   */
  async exactOut(
    user: User,
    input: { asset: OneClickToken; usdc: OneClickToken; amountOut: bigint; recipient: string; dry: boolean; deadline?: number },
  ): Promise<OneClickQuote> {
    if (!input.dry && !this.live) throw new Refusal(409, MAINNET_ONLY);
    return this.client.quote(
      exactOutputRequest({
        asset: input.asset,
        usdc: input.usdc,
        amountOut: input.amountOut,
        nearAccount: this.live ? user.address : PREVIEW_ACCOUNT,
        externalAddress: input.recipient,
        dry: input.dry,
        now: Date.now(),
        deadline: input.deadline,
      }),
    );
  }

  /** Tells 1Click the cash-out deposit landed. Speeds it up; never fails the payment. */
  async depositSent(input: { txHash: string; depositAddress: string; nearSenderAccount: string }): Promise<void> {
    await this.client.submitDeposit(input).catch((error) => console.warn("[intents] deposit submit", error));
  }

  async #quote(
    user: User,
    input: { direction: IntentsDirection; assetId: string; amount: string; address: string; dry: boolean },
  ): Promise<QuoteView> {
    const tokens = await this.client.tokens();
    const asset = chainAssets(tokens).find((candidate) => candidate.assetId === input.assetId);
    if (!asset) throw new Refusal(400, "Pick one of the chains on the list.");
    const usdc = nearUsdc(tokens, this.config.usdcContract, this.config.network);
    if (!usdc) throw new Refusal(503, "NEAR Intents does not list Selkie's USDC right now. Try again later.");

    const request = quoteRequest({
      direction: input.direction,
      asset,
      usdc,
      amount: String(input.amount ?? ""),
      nearAccount: this.live ? user.address : PREVIEW_ACCOUNT,
      externalAddress: String(input.address ?? ""),
      dry: input.dry,
      now: Date.now(),
    });
    const quote = await this.client.quote(request);
    return view(input.direction, !this.live, asset, input.direction === "in" ? usdc.decimals : asset.decimals, quote);
  }
}

function view(
  direction: IntentsDirection,
  preview: boolean,
  asset: ChainAsset,
  outDecimals: number,
  quote: OneClickQuote,
): QuoteView {
  return {
    direction,
    preview,
    asset,
    amountIn: quote.amountIn,
    amountInFormatted: quote.amountInFormatted,
    amountOutFormatted: quote.amountOutFormatted,
    minAmountOutFormatted: quote.minAmountOut ? fromBaseUnits(quote.minAmountOut, outDecimals) : undefined,
    timeEstimate: quote.timeEstimate,
    depositAddress: quote.depositAddress,
    deadline: quote.deadline ?? undefined,
  };
}

export function registerIntentsRoutes(
  app: FastifyInstance,
  deps: {
    desk: IntentsDesk | null;
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<User | null>;
    limited: object;
  },
): void {
  const off = (reply: FastifyReply) => reply.code(503).send({ error: "Moving money between chains is switched off here." });

  app.get("/near/intents/tokens", deps.limited, async (request, reply) => {
    const user = await deps.requireUser(request, reply);
    if (!user) return;
    if (!deps.desk) return off(reply);
    return { live: deps.desk.live, assets: await deps.desk.assets() };
  });

  app.post("/near/intents/quote", deps.limited, async (request, reply) => {
    const user = await deps.requireUser(request, reply);
    if (!user) return;
    if (!deps.desk) return off(reply);
    const body = (request.body ?? {}) as {
      direction?: IntentsDirection;
      assetId?: string;
      amount?: string;
      address?: string;
      commit?: boolean;
    };
    return deps.desk.quote(user, {
      direction: body.direction as IntentsDirection,
      assetId: String(body.assetId ?? ""),
      amount: String(body.amount ?? ""),
      address: String(body.address ?? ""),
      commit: body.commit === true,
    });
  });

  app.get("/near/intents/status", deps.limited, async (request, reply) => {
    const user = await deps.requireUser(request, reply);
    if (!user) return;
    if (!deps.desk) return off(reply);
    const { depositAddress } = (request.query ?? {}) as { depositAddress?: string };
    return deps.desk.status(String(depositAddress ?? ""));
  });
}

/** 1Click's refusals as HTTP: its 4xx are about the request, its 5xx about itself. */
export function intentsErrorStatus(error: IntentsError): number {
  return error.status >= 500 ? 502 : 400;
}
