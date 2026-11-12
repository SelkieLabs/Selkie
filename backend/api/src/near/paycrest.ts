/**
 * Paycrest: USDC in, local currency out to a bank or mobile-money account.
 *
 * The API key and the webhook secret stay here. Banks, rates and the account
 * name check are public, so they work before anyone has a key; only creating
 * and reading orders needs one.
 *
 * Checked against https://docs.paycrest.io (v2) and live public calls on
 * 12 Nov 2026:
 * - GET  /v2/institutions/{currency}             -> { data: [{ name, code, type }] }
 * - GET  /v2/rates/{network}/USDC/{amount}/{fiat}?side=sell
 *                                               -> { data: { sell: { rate, providerIds } } }
 * - POST /v2/verify-account { institution, accountIdentifier }
 *                                               -> { data: "HOLDER NAME" } or { data: "OK" }
 * - POST /v2/sender/orders (API-Key)             -> { data: { id, providerAccount: {
 *        receiveAddress, amountToTransfer, validUntil, network, currency } } }
 * - GET  /v2/sender/orders/{id} (API-Key)
 * - Webhooks sign the raw body: X-Paycrest-Signature = hex HMAC-SHA256 with the
 *   API secret.
 * Errors are `{ status: "error", message, data }`; a 400 may list
 * `data: [{ field, message }]`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** The currencies Selkie offers, naira first. All four are live on Paycrest. */
export const PAYCREST_CURRENCIES = ["NGN", "KES", "UGX", "TZS"] as const;
export type PaycrestCurrency = (typeof PAYCREST_CURRENCIES)[number];

export const isPaycrestCurrency = (value: unknown): value is PaycrestCurrency =>
  typeof value === "string" && (PAYCREST_CURRENCIES as readonly string[]).includes(value);

export interface Institution {
  name: string;
  code: string;
  /** "bank" or "mobile_money" (M-Pesa and the like). */
  type: string;
}

export type PaycrestOrderStatus =
  | "initiated"
  | "deposited"
  | "pending"
  | "fulfilling"
  | "fulfilled"
  | "validated"
  | "settling"
  | "settled"
  | "cancelled"
  | "refunding"
  | "refunded"
  | "expired";

export interface PaycrestOrder {
  id: string;
  status: PaycrestOrderStatus;
  rate?: string;
  amount?: string;
  senderFee?: string;
  transactionFee?: string;
  reference?: string;
  amountPaid?: string;
  amountReturned?: string;
  txHash?: string;
  providerAccount?: {
    network?: string;
    receiveAddress?: string;
    validUntil?: string;
    amountToTransfer?: string;
    currency?: string;
    memo?: string;
  };
}

/** A new off-ramp order, with what has to be paid to fill it. */
export interface CreatedOrder extends PaycrestOrder {
  providerAccount: { network: string; receiveAddress: string; validUntil: string; amountToTransfer: string; currency: string; memo?: string };
}

/** Something Paycrest said no to, in its own words. `status` is Paycrest's HTTP status (0: no answer). */
export class PaycrestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const INSTITUTIONS_TTL_MS = 60 * 60_000;

export interface PaycrestOptions {
  baseUrl?: string;
  apiKey?: string;
  /** Signs webhooks. */
  apiSecret?: string;
  /** Paycrest's network id for the USDC it receives: `base`, `arbitrum-one`, ... */
  network?: string;
  /** Where Paycrest returns USDC on `network` when an order it was paid for fails. */
  refundAddress?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export class PaycrestClient {
  readonly network: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #institutions = new Map<string, { at: number; list: Institution[] }>();

  constructor(private readonly options: PaycrestOptions = {}) {
    this.network = options.network || "base";
    this.#baseUrl = (options.baseUrl || "https://api.paycrest.io").replace(/\/$/, "");
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  /** Orders need a key, and somewhere for Paycrest to send money back if one fails. */
  get canPay(): boolean {
    return Boolean(this.options.apiKey && this.options.refundAddress);
  }

  get canVerifyWebhooks(): boolean {
    return Boolean(this.options.apiSecret);
  }

  /** Banks (and mobile-money services) for a currency. Cached: the list changes rarely. */
  async institutions(currency: PaycrestCurrency): Promise<Institution[]> {
    const cached = this.#institutions.get(currency);
    if (cached && this.#now() - cached.at < INSTITUTIONS_TTL_MS) return cached.list;
    const data = await this.#call<unknown>("GET", `/v2/institutions/${currency}`);
    if (!Array.isArray(data)) throw new PaycrestError("Paycrest sent an unexpected bank list.", 502);
    const list = data
      .filter((row): row is Institution => typeof row?.name === "string" && typeof row?.code === "string")
      .map((row) => ({ name: row.name, code: row.code, type: typeof row.type === "string" ? row.type : "bank" }));
    this.#institutions.set(currency, { at: this.#now(), list });
    return list;
  }

  /**
   * The name on an account. Null when the account is fine but Paycrest cannot
   * show a name for it (it answers "OK" for some mobile money), in which case
   * the person types the name themselves.
   */
  async verifyAccount(institution: string, accountIdentifier: string): Promise<{ accountName: string | null }> {
    const data = await this.#call<unknown>("POST", "/v2/verify-account", { institution, accountIdentifier });
    if (typeof data !== "string" || !data.trim()) throw new PaycrestError("Paycrest sent no name for that account.", 502);
    const name = data.trim();
    return { accountName: name.toUpperCase() === "OK" ? null : name };
  }

  /** Local currency per 1 USDC, selling `amount` USDC. */
  async rate(amount: string, currency: PaycrestCurrency): Promise<{ rate: string; providerIds: string[] }> {
    const data = await this.#call<{ sell?: { rate?: unknown; providerIds?: unknown } }>(
      "GET",
      `/v2/rates/${encodeURIComponent(this.network)}/USDC/${encodeURIComponent(amount)}/${currency}?side=sell`,
    );
    const rate = data?.sell?.rate;
    if (typeof rate !== "string" || !/^\d+(\.\d+)?$/.test(rate) || /^0+(\.0+)?$/.test(rate)) {
      throw new PaycrestError("Paycrest has no rate for that right now.", 502);
    }
    const ids = Array.isArray(data.sell?.providerIds) ? data.sell.providerIds.filter((id): id is string => typeof id === "string") : [];
    return { rate, providerIds: ids };
  }

  /**
   * An off-ramp order: `amount` USDC on `network` becomes local currency in
   * this account. Paycrest answers with the address to pay and exactly how
   * much (`amount` plus its transaction fee).
   */
  async createOrder(input: {
    amount: string;
    currency: PaycrestCurrency;
    institution: string;
    accountIdentifier: string;
    accountName: string;
    reference: string;
    memo?: string;
  }): Promise<CreatedOrder> {
    if (!this.options.apiKey) throw new PaycrestError("Bank payouts aren't switched on yet.", 0);
    if (!this.options.refundAddress) throw new PaycrestError("Bank payouts aren't switched on yet.", 0);
    const order = await this.#call<PaycrestOrder>(
      "POST",
      "/v2/sender/orders",
      {
        amount: input.amount,
        amountIn: "crypto",
        reference: input.reference,
        source: { type: "crypto", currency: "USDC", network: this.network, refundAddress: this.options.refundAddress },
        destination: {
          type: "fiat",
          currency: input.currency,
          recipient: {
            institution: input.institution,
            accountIdentifier: input.accountIdentifier,
            accountName: input.accountName,
            memo: input.memo ?? "Selkie cash out",
          },
        },
      },
      true,
    );
    const account = order?.providerAccount;
    if (
      !order?.id ||
      !account?.receiveAddress ||
      !account.amountToTransfer ||
      !/^\d+(\.\d+)?$/.test(account.amountToTransfer) ||
      !account.validUntil ||
      Number.isNaN(Date.parse(account.validUntil))
    ) {
      throw new PaycrestError("Paycrest sent an order without somewhere to pay it. Nothing moved.", 502);
    }
    return {
      ...order,
      providerAccount: {
        network: account.network ?? this.network,
        receiveAddress: account.receiveAddress,
        validUntil: account.validUntil,
        amountToTransfer: account.amountToTransfer,
        currency: account.currency ?? "USDC",
        memo: account.memo,
      },
    };
  }

  async getOrder(id: string): Promise<PaycrestOrder> {
    if (!this.options.apiKey) throw new PaycrestError("Bank payouts aren't switched on yet.", 0);
    const order = await this.#call<PaycrestOrder>("GET", `/v2/sender/orders/${encodeURIComponent(id)}`, undefined, true);
    if (!order?.id || typeof order.status !== "string") throw new PaycrestError("Paycrest sent an unexpected order.", 502);
    return order;
  }

  /**
   * Did Paycrest send this webhook? The signature is the hex HMAC-SHA256 of the
   * exact bytes received, keyed with the API secret, so this must see the raw
   * body, not JSON parsed and printed again.
   */
  verifySignature(rawBody: string | Buffer, signature: string | undefined): boolean {
    const secret = this.options.apiSecret;
    if (!secret || !signature) return false;
    const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
    const given = Buffer.from(signature.trim().toLowerCase(), "utf8");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  async #call<T>(method: "GET" | "POST", path: string, body?: unknown, keyed = false): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (keyed && this.options.apiKey) headers["API-Key"] = this.options.apiKey;
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new PaycrestError("Could not reach Paycrest. Try again in a moment.", 0);
    }
    const parsed = (await response.json().catch(() => null)) as { status?: unknown; message?: unknown; data?: unknown } | null;
    if (!response.ok || parsed?.status === "error") {
      throw new PaycrestError(paycrestWords(response.status, parsed), response.ok ? 400 : response.status);
    }
    if (parsed === null) throw new PaycrestError("Paycrest sent an empty answer.", 502);
    return parsed.data as T;
  }
}

/**
 * Paycrest's own message, which is written for people ("No provider available
 * for this corridor", "complete business verification to start initiating
 * payment orders"). A validation error also names each field it disliked.
 */
export function paycrestWords(status: number, body: { message?: unknown; data?: unknown } | null): string {
  const said = typeof body?.message === "string" ? body.message.trim() : "";
  const fields = Array.isArray(body?.data)
    ? body.data
        .map((item: { field?: unknown; message?: unknown }) =>
          typeof item?.message === "string" ? (typeof item.field === "string" ? `${item.field}: ${item.message}` : item.message) : null,
        )
        .filter((line): line is string => Boolean(line))
    : [];
  if (said && fields.length > 0) return `${said} (${fields.join("; ")})`;
  if (said) return said;
  if (status === 401 || status === 403) return "Paycrest did not accept Selkie's key.";
  if (status >= 500 || status === 0) return "Paycrest did not answer just now. Try again in a moment.";
  return "Paycrest could not do that.";
}

/**
 * `amount * rate`, cut to `places` decimals, without floats. For showing what
 * arrives; the order itself is priced by Paycrest.
 */
export function multiplyDecimal(amount: string, rate: string, places = 2): string {
  const [aWhole = "0", aFrac = ""] = amount.split(".");
  const [rWhole = "0", rFrac = ""] = rate.split(".");
  const product = BigInt(`${aWhole}${aFrac}` || "0") * BigInt(`${rWhole}${rFrac}` || "0");
  const scale = aFrac.length + rFrac.length;
  const digits = product.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale).padEnd(places, "0").slice(0, places);
  return places > 0 ? `${whole}.${frac}` : whole;
}
