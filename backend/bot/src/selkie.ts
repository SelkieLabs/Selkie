import { signBotToken } from "@selkie/core";
import type { BotPlatform } from "@selkie/core";

/**
 * The bot's client for Selkie's own API.
 *
 * Every call is made AS the person who sent the message, using a freshly minted
 * bot token, so the bot exercises exactly the routes the web app does and gets
 * exactly the same answers. Nothing about a payment is decided here.
 *
 * A token per call, rather than one cached per user, because they are cheap to
 * mint and live for a minute: there is nothing worth keeping and nothing worth
 * stealing from a process that holds none.
 */

export interface Sender {
  platform: BotPlatform;
  /** The platform's permanent numeric id for this person. */
  subject: string;
  /** Their handle as it reads today. */
  username: string;
}

export interface SendResult {
  status: string;
  ref: string;
  message: string;
  waitingToBeClaimed: boolean;
}

export interface Balance {
  amount: string;
  asset: string;
}

export interface Me {
  user: { id: string; address: string; handles: { platform: string; username: string }[] };
  balances: Balance[];
}

/**
 * An error carrying what the API said, in the API's own words.
 *
 * The API already writes its refusals in plain language for the web app to show,
 * so a bot that invents its own wording would drift out of step with the product
 * and would have to guess at meanings it was handed.
 */
export class SelkieApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SelkieApiError";
  }
}

export interface SelkieClientOptions {
  baseUrl: string;
  botSecret: string;
  /** How long to wait on the API before giving up and saying so. */
  timeoutMs?: number;
}

export class SelkieClient {
  readonly #baseUrl: string;
  readonly #botSecret: string;
  readonly #timeoutMs: number;

  constructor(options: SelkieClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#botSecret = options.botSecret;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
  }

  /**
   * Who Selkie thinks this person is, or null if they have never signed in.
   *
   * A 401 here is not an error to report. It is the ordinary case of somebody
   * tweeting at Selkie who does not have an account yet, and the reply should
   * invite them in rather than sound like a failure.
   */
  async me(sender: Sender): Promise<Me | null> {
    try {
      return await this.#call<Me>(sender, "GET", "/me");
    } catch (error) {
      if (error instanceof SelkieApiError && error.status === 401) return null;
      throw error;
    }
  }

  async send(
    sender: Sender,
    payment: { to: string; amount: string; asset: string; note?: string; platform?: string },
  ): Promise<SendResult> {
    return this.#call(sender, "POST", "/payments/send", payment, {
      /**
       * The key is the message, not the payment.
       *
       * If a poll overlaps a retry and the same tweet is read twice, the second
       * attempt returns the first one's answer instead of paying again. Keying
       * on the amount and payee instead would wrongly collapse two genuine
       * payments of the same amount to the same person.
       */
      idempotencyKey: `${sender.platform}:${payment.to}:${sender.subject}`,
    });
  }

  async request(
    sender: Sender,
    ask: { from: string; amount: string; asset: string; platform?: string },
  ): Promise<{ id: string }> {
    return this.#call(sender, "POST", "/requests", ask);
  }


  async #call<T>(
    sender: Sender,
    method: string,
    path: string,
    body?: unknown,
    options: { idempotencyKey?: string } = {},
  ): Promise<T> {
    const token = await signBotToken(
      { platform: sender.platform, subject: sender.subject, username: sender.username },
      this.#botSecret,
    );

    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

    // A hung request must not stall the poll loop behind it, or one slow call
    // silently stops the bot answering anybody.
    const abort = AbortSignal.timeout(this.#timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abort,
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "failed";
      throw new SelkieApiError(`Selkie is not answering right now (${reason}).`, 503);
    }

    const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
    if (!response.ok) {
      throw new SelkieApiError(payload.error ?? "Something went wrong.", response.status);
    }
    return payload;
  }
}
