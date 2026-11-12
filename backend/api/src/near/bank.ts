/**
 * Cash out to a bank account: USDC on NEAR -> NEAR Intents -> USDC on Base ->
 * Paycrest -> local currency in the account (naira first).
 *
 *   1. Paycrest makes an order for the amount and says where to pay it on Base
 *      and exactly how much (`amountToTransfer`: the amount plus its fee).
 *   2. NEAR Intents quotes EXACT_OUTPUT: whatever USDC on NEAR it takes for
 *      exactly that much to land at that address, refunded to the person's own
 *      NEAR account if the swap cannot fill.
 *   3. The person signs one ft_transfer of that USDC to the quote's deposit
 *      address, relayed like any other payment. Selkie never holds it.
 *
 * Banks, rates and the account-name check are public and work everywhere.
 * Orders need Paycrest's key, a refund address, NEAR mainnet and 1Click; until
 * all four are there, the flow is a preview that says why.
 *
 * Trust: if Paycrest fails after it was paid, it returns the USDC on Base to
 * PAYCREST_REFUND_ADDRESS, which is Selkie's, not the person's. Selkie then has
 * to send it back by hand. Failures before that (the swap) refund to the
 * person's own NEAR account with nobody in between.
 */
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  TERMINAL_STATUSES,
  USDC_DECIMALS,
  fromBaseUnits,
  toBaseUnits,
  toPositiveBaseUnits,
  type NearPublicConfig,
  type OneClickQuote,
  type OneClickStatusName,
} from "@selkie/chain-near";
import type { User } from "../identity/types";
import type { IntentsDesk } from "./intents";
import {
  PAYCREST_CURRENCIES,
  PaycrestError,
  isPaycrestCurrency,
  multiplyDecimal,
  type CreatedOrder,
  type Institution,
  type PaycrestClient,
  type PaycrestCurrency,
  type PaycrestOrderStatus,
} from "./paycrest";
import { Refusal } from "./refusal";

/** Paycrest's network ids, as 1Click names the same chains. Checked in both docs. */
const ONECLICK_CHAIN: Record<string, string> = {
  base: "base",
  "arbitrum-one": "arb",
  ethereum: "eth",
  polygon: "pol",
  "bnb-smart-chain": "bsc",
};

export const BANK_TESTNET =
  "Bank payouts run on NEAR mainnet. This is the testnet version: real banks, real rates and a real name check, but nothing is sent.";
export const BANK_OFF =
  "Bank payouts aren't switched on yet. You can see banks, rates and check the account name, but nothing is sent.";

/**
 * How far over the previewed cost a confirmed cash-out may come in. The
 * preview cannot know Paycrest's transaction fee, which is fixed only when the
 * order is made, and stablecoin swaps move a little.
 */
const SEND_SLACK_BPS = 100n;
const SEND_SLACK_UNITS = 250_000n; // $0.25
/** The swap must be done with time to spare before Paycrest's order runs out. */
const PAYCREST_MARGIN_MS = 2 * 60_000;
const MIN_WINDOW_MS = 3 * 60_000;
const QUOTE_WINDOW_MS = 10 * 60_000;

export interface BankQuoteView {
  /** NEAR mainnet. */
  live: boolean;
  /** Pressing send makes a real order. */
  payoutsOn: boolean;
  /** Why it is only a preview, when it is. */
  note?: string;
  currency: PaycrestCurrency;
  /** USDC the order is for. */
  amount: string;
  /** Local currency per 1 USDC. */
  rate: string;
  /** About what arrives in the bank, at that rate. */
  fiatAmount: string;
  /** About what leaves the NEAR account: the order plus the swap. */
  sendAbout?: string;
  /** The most the confirmed cash-out may take. Sent back as `maxSend`. */
  sendAtMost?: string;
  /** Seconds, 1Click's estimate for the swap. */
  timeEstimate?: number;
}

/** A cash-out to a bank, as prepare built it and the activity feed shows it. */
export interface BankOrderPlan {
  order: CreatedOrder;
  quote: OneClickQuote & { depositAddress: string };
  institutionName: string;
  fiatAmount: string;
}

/**
 * swapping: NEAR Intents is moving the USDC to Base. paying: Paycrest has it
 * and is paying the bank. paid: the bank has it. back-to-you: the swap failed
 * and the USDC is back in the NEAR account. returning/returned: Paycrest could
 * not pay and is sending the USDC to Selkie's refund address. expired: nobody
 * paid the order, nothing moved. late: the order ran out as the money landed,
 * which Selkie has to sort out with Paycrest.
 */
export type BankStage = "swapping" | "paying" | "paid" | "back-to-you" | "returning" | "returned" | "expired" | "late";

export interface BankStatusView {
  orderId: string;
  stage: BankStage;
  done: boolean;
  paycrest: { status: PaycrestOrderStatus; rate?: string; amount?: string; fiatAmount?: string; txHash?: string } | null;
  intents: { status: OneClickStatusName; refundReason?: string; originTxs: string[]; destinationTxs: string[] } | null;
}

export class BankDesk {
  /** The latest webhook per order: a quicker word than polling, never the only one. */
  readonly #heard = new Map<string, PaycrestOrderStatus>();

  constructor(
    private readonly paycrest: PaycrestClient,
    private readonly intents: IntentsDesk | null,
    private readonly config: NearPublicConfig,
  ) {}

  get live(): boolean {
    return this.config.network === "mainnet";
  }

  get payoutsOn(): boolean {
    return this.offReason() === null;
  }

  /** Why pressing send would not make a real order, or null when it would. */
  offReason(): string | null {
    if (!this.live) return BANK_TESTNET;
    if (!this.paycrest.canPay || !this.intents || !ONECLICK_CHAIN[this.paycrest.network]) return BANK_OFF;
    return null;
  }

  currencies() {
    return { live: this.live, payoutsOn: this.payoutsOn, note: this.offReason() ?? undefined, currencies: [...PAYCREST_CURRENCIES] };
  }

  async banks(currency: unknown): Promise<Institution[]> {
    return this.paycrest.institutions(this.#currency(currency));
  }

  /** The name on the account, so the person can see it is theirs before anything moves. */
  async verify(input: { currency: unknown; institution: unknown; accountIdentifier: unknown }) {
    const bank = await this.#institution(input.currency, input.institution);
    const account = cleanAccount(input.accountIdentifier);
    const { accountName } = await this.paycrest.verifyAccount(bank.code, account);
    return { institution: bank.code, institutionName: bank.name, accountName };
  }

  /** The rate, what arrives, and about what it costs to send. Works with no key, as a preview. */
  async quote(user: User, input: { currency: unknown; amount: unknown }): Promise<BankQuoteView> {
    const currency = this.#currency(input.currency);
    const units = usdcUnits(input.amount);
    const amount = fromBaseUnits(units, USDC_DECIMALS);
    const { rate } = await this.paycrest.rate(amount, currency);
    const view: BankQuoteView = {
      live: this.live,
      payoutsOn: this.payoutsOn,
      note: this.offReason() ?? undefined,
      currency,
      amount,
      rate,
      fiatAmount: multiplyDecimal(amount, rate, 2),
    };
    const chain = ONECLICK_CHAIN[this.paycrest.network];
    if (!this.intents || !chain) return view;
    try {
      const { asset, usdc } = await this.intents.usdcOn(chain);
      const quote = await this.intents.exactOut(user, {
        asset,
        usdc,
        amountOut: toBaseUnits(amount, asset.decimals),
        // Pricing only: a dry quote makes no deposit address, so nothing can
        // be sent to this. Paycrest's own refund address when there is one,
        // else the USDC contract on that chain, which 1Click lists itself.
        recipient: this.paycrest.refundAddress ?? asset.contractAddress ?? "",
        dry: true,
      });
      const about = BigInt(quote.amountIn);
      return {
        ...view,
        sendAbout: fromBaseUnits(about, usdc.decimals),
        sendAtMost: fromBaseUnits(withSlack(about), usdc.decimals),
        timeEstimate: quote.timeEstimate,
      };
    } catch (error) {
      // The rate still helps without the swap price; say nothing worse than "about".
      console.warn("[bank] swap preview", error instanceof Error ? error.message : error);
      return view;
    }
  }

  /**
   * The real thing, at the moment the person confirms: a Paycrest order, then
   * a committed EXACT_OUTPUT quote that pays it. Refused, with nothing made
   * on chain, if anything is off.
   */
  async openOrder(
    user: User,
    input: { currency: unknown; institution: unknown; accountIdentifier: unknown; accountName: unknown; units: bigint; maxSend: unknown },
  ): Promise<BankOrderPlan> {
    const off = this.offReason();
    if (off) throw new Refusal(409, off);
    const intents = this.intents!;
    const currency = this.#currency(input.currency);
    const bank = await this.#institution(currency, input.institution);
    const accountIdentifier = cleanAccount(input.accountIdentifier);
    const accountName = typeof input.accountName === "string" ? input.accountName.trim().slice(0, 120) : "";
    if (!accountName) throw new Refusal(400, "Add the name on the account.");
    const maxSend = usdcUnits(input.maxSend, "Review the price again, then confirm.");
    const amount = fromBaseUnits(input.units, USDC_DECIMALS);
    const { asset, usdc } = await intents.usdcOn(ONECLICK_CHAIN[this.paycrest.network]!);

    const order = await this.paycrest.createOrder({
      amount,
      currency,
      institution: bank.code,
      accountIdentifier,
      accountName,
      reference: orderReference(user.id),
    });
    const account = order.providerAccount;
    if (account.currency.toUpperCase() !== "USDC" || account.network !== this.paycrest.network) {
      throw new Refusal(502, "Paycrest asked to be paid in something other than USDC on " + this.paycrest.network + ". Nothing moved.");
    }
    if (account.memo) throw new Refusal(502, "Paycrest asked for a memo with the payment, which a swap cannot add. Nothing moved.");

    const now = Date.now();
    const deadline = Math.min(now + QUOTE_WINDOW_MS, Date.parse(account.validUntil) - PAYCREST_MARGIN_MS);
    if (deadline - now < MIN_WINDOW_MS) throw new Refusal(502, "Paycrest's order runs out too soon to pay safely. Nothing moved. Try again.");

    const quote = await intents.exactOut(user, {
      asset,
      usdc,
      amountOut: toBaseUnits(account.amountToTransfer, asset.decimals),
      recipient: account.receiveAddress,
      dry: false,
      deadline,
    });
    if (!quote.depositAddress) throw new Refusal(502, "NEAR Intents sent no deposit address. Nothing moved. Try again.");
    if (BigInt(quote.amountIn) > maxSend) {
      throw new Refusal(409, `The price moved: it now takes ${fromBaseUnits(BigInt(quote.amountIn), usdc.decimals)} USDC. Review it again.`);
    }
    return {
      order,
      quote: { ...quote, depositAddress: quote.depositAddress },
      institutionName: bank.name,
      fiatAmount: multiplyDecimal(amount, order.rate ?? "0", 2),
    };
  }

  /** Where a bank cash-out has got to: the swap first, then Paycrest. Only the person who made it can ask. */
  async status(user: User, input: { orderId: unknown; depositAddress?: unknown }): Promise<BankStatusView> {
    const orderId = typeof input.orderId === "string" ? input.orderId.trim() : "";
    if (!/^[A-Za-z0-9-]{6,80}$/.test(orderId)) throw new Refusal(400, "That is not a cash-out we know.");
    const order = await this.paycrest.getOrder(orderId).catch((error: unknown) => {
      if (error instanceof PaycrestError && error.status === 404) throw new Refusal(404, "That is not a cash-out we know.");
      throw error;
    });
    if (!order.reference?.startsWith(`${referencePrefix(user.id)}-`)) throw new Refusal(404, "That is not a cash-out we know.");

    const depositAddress = typeof input.depositAddress === "string" ? input.depositAddress : "";
    const swap = depositAddress && this.intents ? await this.intents.status(depositAddress).catch(() => null) : null;
    const paycrestStatus = latest(order.status, this.#heard.get(orderId));
    const stage = stageOf(paycrestStatus, swap?.status ?? null);
    return {
      orderId,
      stage,
      done: stage !== "swapping" && stage !== "paying" && stage !== "returning",
      paycrest: {
        status: paycrestStatus,
        rate: order.rate,
        amount: order.amount,
        fiatAmount: order.amount && order.rate ? multiplyDecimal(order.amount, order.rate, 2) : undefined,
        txHash: order.txHash,
      },
      intents: swap
        ? { status: swap.status, refundReason: swap.refundReason, originTxs: swap.originTxs, destinationTxs: swap.destinationTxs }
        : null,
    };
  }

  /**
   * A Paycrest webhook. Only a body signed with the API secret counts; it is
   * remembered so the next status read can be ahead of Paycrest's own API.
   */
  webhook(rawBody: string, signature: string | undefined): { orderId: string; status: PaycrestOrderStatus } | null {
    if (!this.paycrest.canVerifyWebhooks) throw new Refusal(503, "Webhooks are not set up here.");
    if (!this.paycrest.verifySignature(rawBody, signature)) throw new Refusal(401, "Bad signature.");
    let event: { event?: unknown; data?: { id?: unknown; status?: unknown } };
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw new Refusal(400, "Not JSON.");
    }
    const id = event?.data?.id;
    const status = event?.data?.status;
    if (typeof id !== "string" || typeof status !== "string") return null;
    this.#heard.set(id, status as PaycrestOrderStatus);
    console.log("[bank] webhook", String(event.event), id, status);
    return { orderId: id, status: status as PaycrestOrderStatus };
  }

  #currency(value: unknown): PaycrestCurrency {
    const code = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (!isPaycrestCurrency(code)) throw new Refusal(400, `Pick a currency: ${PAYCREST_CURRENCIES.join(", ")}.`);
    return code;
  }

  async #institution(currency: unknown, institution: unknown): Promise<Institution> {
    const code = typeof institution === "string" ? institution.trim() : "";
    const bank = (await this.paycrest.institutions(this.#currency(currency))).find((candidate) => candidate.code === code);
    if (!bank) throw new Refusal(400, "Pick a bank from the list.");
    return bank;
  }
}

/** Every order carries who made it, hashed, so status can only be read by them. */
function referencePrefix(userId: string): string {
  return `selkie-${createHash("sha256").update(`selkie bank order:${userId}`).digest("hex").slice(0, 16)}`;
}

function orderReference(userId: string): string {
  return `${referencePrefix(userId)}-${randomBytes(4).toString("hex")}`;
}

function cleanAccount(value: unknown): string {
  const account = typeof value === "string" ? value.replace(/[\s-]/g, "") : "";
  if (!/^[0-9]{6,20}$/.test(account)) throw new Refusal(400, "Enter the account number, digits only.");
  return account;
}

function usdcUnits(value: unknown, problem = "Enter an amount above zero, up to 6 decimal places."): bigint {
  try {
    return toPositiveBaseUnits(String(value ?? ""), USDC_DECIMALS);
  } catch {
    throw new Refusal(400, problem);
  }
}

function withSlack(units: bigint): bigint {
  const percent = (units * SEND_SLACK_BPS + 9_999n) / 10_000n;
  return units + (percent > SEND_SLACK_UNITS ? percent : SEND_SLACK_UNITS);
}

/** Paycrest statuses in the order an order moves through them; a webhook can only move one forward. */
const ORDER: PaycrestOrderStatus[] = [
  "initiated",
  "deposited",
  "pending",
  "fulfilling",
  "fulfilled",
  "validated",
  "settling",
  "settled",
];
const FINAL: PaycrestOrderStatus[] = ["settled", "refunded", "expired", "cancelled"];

function latest(polled: PaycrestOrderStatus, heard: PaycrestOrderStatus | undefined): PaycrestOrderStatus {
  if (!heard || FINAL.includes(polled)) return polled;
  if (FINAL.includes(heard) || heard === "refunding") return heard;
  return ORDER.indexOf(heard) > ORDER.indexOf(polled) ? heard : polled;
}

/** One plain stage from both halves. Paycrest wins once it has the money; the swap decides before that. */
export function stageOf(paycrest: PaycrestOrderStatus, swap: OneClickStatusName | null): BankStage {
  if (paycrest === "settled" || paycrest === "validated") return "paid";
  if (paycrest === "refunding") return "returning";
  if (paycrest === "refunded") return "returned";
  if (swap && TERMINAL_STATUSES.includes(swap) && swap !== "SUCCESS") return "back-to-you";
  if (paycrest === "expired" || paycrest === "cancelled") return swap === "SUCCESS" ? "late" : "expired";
  if (paycrest !== "initiated") return "paying";
  return "swapping";
}

export function registerBankRoutes(
  app: FastifyInstance,
  deps: {
    desk: BankDesk | null;
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<User | null>;
    limited: object;
  },
): void {
  const off = (reply: FastifyReply) => reply.code(503).send({ error: "Cash out to a bank is switched off here." });

  app.get("/near/bank/currencies", deps.limited, async (request, reply) => {
    const user = await deps.requireUser(request, reply);
    if (!user) return;
    if (!deps.desk) return off(reply);
    return deps.desk.currencies();
  });

  app.get("/near/bank/institutions", deps.limited, async (request, reply) => {
    const user = await deps.requireUser(request, reply);
    if (!user) return;
    if (!deps.desk) return off(reply);
    const { currency } = (request.query ?? {}) as { currency?: string };
    return { institutions: await deps.desk.banks(currency) };
  });

  app.post("/near/bank/verify", deps.limited, async (request, reply) => {
    const user = await deps.requireUser(request, reply);
    if (!user) return;
    if (!deps.desk) return off(reply);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return deps.desk.verify({ currency: body.currency, institution: body.institution, accountIdentifier: body.accountIdentifier });
  });

  app.post("/near/bank/quote", deps.limited, async (request, reply) => {
    const user = await deps.requireUser(request, reply);
    if (!user) return;
    if (!deps.desk) return off(reply);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return deps.desk.quote(user, { currency: body.currency, amount: body.amount });
  });

  app.get("/near/bank/status", deps.limited, async (request, reply) => {
    const user = await deps.requireUser(request, reply);
    if (!user) return;
    if (!deps.desk) return off(reply);
    const query = (request.query ?? {}) as { orderId?: string; depositAddress?: string };
    return deps.desk.status(user, { orderId: query.orderId, depositAddress: query.depositAddress });
  });

  // Paycrest signs the exact bytes it sends, so this one route reads its body
  // as a string. Scoped to its own plugin: every other route still gets JSON.
  void app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => done(null, body));
    scope.post("/near/bank/webhook", async (request, reply) => {
      if (!deps.desk) return off(reply);
      const signature = request.headers["x-paycrest-signature"];
      deps.desk.webhook(String(request.body ?? ""), Array.isArray(signature) ? signature[0] : signature);
      return { ok: true };
    });
  });
}

/** Paycrest's refusals as HTTP: about the request (400), about Paycrest or Selkie's setup (502/503). */
export function paycrestErrorStatus(error: PaycrestError): number {
  if (error.status === 0) return 503;
  if (error.status === 401) return 503;
  return error.status >= 500 ? 502 : 400;
}
