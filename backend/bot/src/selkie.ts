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
  /**
   * The message that asked for this, by the platform's id for it.
   *
   * Required rather than optional, because it is what makes a payment
   * repeatable-but-not-repeated and forgetting it is not a small mistake. The
   * bot acts only because somebody wrote something; this is which something.
   */
  messageId: string;
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

/** How long a pocket send may take: the API answers once NEAR has finalised it. */
const POCKET_SEND_TIMEOUT_MS = 60_000;

/** What the API did with a "send" from somebody's X pocket (NEAR). Amounts are decimal USDC. */
export type PocketSendResult =
  | { status: "sent"; txHash: string; explorerUrl: string; amount: string; to: string; toAccount: string; leftToday: string }
  | {
      status: "no-account" | "no-pocket" | "not-on-selkie" | "low-balance" | "over-cap" | "failed";
      leftToday?: string;
      message?: string;
    };

/** What the API answers when the bot makes a tweeted ask (NEAR). */
export type PocketAskResult =
  | { status: "asked"; id: string; from: string; amount: string }
  | { status: "no-account" | "failed"; message?: string };

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
       * The key is the message, and nothing else.
       *
       * If a poll overlaps a retry and the same post is read twice, the second
       * attempt returns the first one's answer instead of paying again. One
       * post means one payment, however many times we happen to read it.
       *
       * It used to be platform, payee and sender, which contains no reference
       * to the message at all despite the comment above it claiming otherwise.
       * The effect was that the FIRST payment between two people worked and
       * every payment between them afterwards, of any amount, quietly returned
       * that first one's answer: Selkie replied "Sent!" and moved nothing. Two
       * real payments were lost to it before anybody noticed, because the reply
       * looked exactly like success.
       */
      idempotencyKey: `${sender.platform}:${sender.messageId}`,
    });
  }

  async request(
    sender: Sender,
    ask: { from: string; amount: string; asset: string; platform?: string },
  ): Promise<{ id: string }> {
    // Keyed the same way. A request moves no money, but two identical ones from
    // one post is still a bug the person on the other end has to look at.
    return this.#call(sender, "POST", "/requests", ask, {
      idempotencyKey: `${sender.platform}:${sender.messageId}`,
    });
  }

  /**
   * NEAR: pay from the sender's X pocket, because they tweeted.
   *
   * Not made as the person, unlike everything above: on NEAR nobody's account
   * can be signed for. The secret proves the request is the bot's, and the API
   * pays only from this X user's own pocket, only to people on Selkie, only up
   * to their daily limit. Keyed on the post, so reading it twice pays once.
   */
  async pocketSend(
    sender: Sender,
    payment: { to: string; amount: string; note?: string },
  ): Promise<PocketSendResult> {
    return this.#fetch(
      "POST",
      "/near/bot/send",
      { "x-selkie-bot-secret": this.#botSecret },
      {
        tweetId: sender.messageId,
        senderXUserId: sender.subject,
        senderHandle: sender.username,
        to: payment.to,
        amount: payment.amount,
        ...(payment.note ? { note: payment.note } : {}),
      },
      // The API waits for the transfer to be final before it answers. Giving up
      // early would mean a link reply for money that did move.
      Math.max(this.#timeoutMs, POCKET_SEND_TIMEOUT_MS),
    );
  }

  /**
   * NEAR: make the ask someone tweeted, as them.
   *
   * A request moves no money, so there is nothing to sign: the same secret as
   * a pocket send proves it is the bot, and the API asks from the X account X
   * says wrote the tweet. Keyed on the post, so reading it twice asks once.
   */
  async botRequest(sender: Sender, ask: { from: string; amount: string; note?: string }): Promise<PocketAskResult> {
    return this.#fetch("POST", "/near/bot/request", { "x-selkie-bot-secret": this.#botSecret }, {
      tweetId: sender.messageId,
      senderXUserId: sender.subject,
      from: ask.from,
      amount: ask.amount,
      ...(ask.note ? { note: ask.note } : {}),
    });
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
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
    return this.#fetch(method, path, headers, body);
  }

  async #fetch<T>(
    method: string,
    path: string,
    given: Record<string, string>,
    body?: unknown,
    timeoutMs = this.#timeoutMs,
  ): Promise<T> {
    const headers = { ...given };
    if (body !== undefined) headers["content-type"] = "application/json";

    // A hung request must not stall the poll loop behind it, or one slow call
    // silently stops the bot answering anybody.
    const abort = AbortSignal.timeout(timeoutMs);

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
