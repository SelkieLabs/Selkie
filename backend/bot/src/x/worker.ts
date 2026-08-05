import { parseCommand } from "../parse";
import { respond } from "../respond";
import type { SelkieClient } from "../selkie";
import type { StateStore } from "../state";
import { XApiError } from "./client";
import type { Mention, RateLimit, XClient } from "./client";

/**
 * The X surface: mentions in, replies out.
 *
 * Everything about what a message MEANS lives in the parser and in respond, so
 * this file is only the loop and the etiquette around it. That split is what
 * makes Telegram a transport rather than a rewrite.
 *
 * Three rules keep it from being expensive or embarrassing.
 *
 * It never replays. A restart resumes from the last mention it handled, because
 * on a payments bot replaying a backlog means paying everybody a second time.
 *
 * It never answers itself. Its own replies appear in its own mentions, and a bot
 * that reads those is a bot in a conversation with itself, forever, billed by
 * the post.
 *
 * It backs off when told to. X answers a rate limit with the time the window
 * resets, and honouring that is the difference between waiting once and burning
 * the remaining quota against a closed door.
 *
 * And it changes speed. See `#pace` below: how fast to look is a question with
 * a real answer, and X supplies the numbers to work it out.
 */

/** Remembered ids, so a mention is not handled twice inside one run. */
const SEEN_LIMIT = 500;

/** Longest wait between polls when X keeps refusing. */
const MAX_BACKOFF_MS = 15 * 60 * 1000;

/**
 * How long a conversation stays "live" after the last message.
 *
 * Somebody who just tweeted at Selkie is probably about to tweet again, and
 * they are watching the screen while they do it. Somebody who tweeted an hour
 * ago is not. This is the window in which the fast interval applies.
 */
const WARM_MS = 3 * 60 * 1000;

export interface XWorkerOptions {
  client: XClient;
  selkie: SelkieClient;
  /** The bot's own handle, without the @. */
  handle: string;
  /** Where people are pointed to open their wallet. */
  webUrl: string;
  state: StateStore;
  /** How long to wait between polls when nothing is happening. */
  pollMs?: number;
  /** How long to wait between polls while a conversation is live. */
  activeMs?: number;
  /**
   * Work out every reply and post none of them.
   *
   * The setting to run in until the behaviour has been watched: posting is
   * public and metered, and a bot loose on a timeline is hard to take back.
   */
  dryRun?: boolean;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface PollResult {
  read: number;
  answered: number;
  /** What the next wait will be, so the loop and a test can both see it. */
  nextPollMs: number;
}

export class XWorker {
  readonly #options: Required<Omit<XWorkerOptions, "client" | "selkie" | "state">> &
    Pick<XWorkerOptions, "client" | "selkie" | "state">;
  readonly #seen = new Set<string>();
  #sinceId: string | null;
  #userId: string | null = null;
  #running = false;
  /**
   * Whether we know where "new" starts.
   *
   * False on a very first run, where the first poll only establishes a baseline
   * and acts on nothing. Otherwise the bot's debut is answering every mention
   * @SelkiePay has ever received.
   */
  #haveBaseline: boolean;
  #backoffMs = 0;
  /** When the current conversation stops counting as live. */
  #warmUntil = 0;

  constructor(options: XWorkerOptions) {
    this.#options = {
      pollMs: 60_000,
      activeMs: 5_000,
      dryRun: false,
      log: console.log,
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      ...options,
      handle: options.handle.replace(/^@/, ""),
    };

    const saved = options.state.read();
    this.#sinceId = saved.sinceId ?? null;
    this.#haveBaseline = saved.sinceId != null;
  }

  get dryRun(): boolean {
    return this.#options.dryRun;
  }

  /** One cycle. Separate from the loop so a test can drive it directly. */
  async poll(): Promise<PollResult> {
    if (!this.#userId) this.#userId = await this.#options.client.selfId(this.#options.handle);

    const { mentions, newestId, rateLimit } = await this.#options.client.mentions(
      this.#userId,
      this.#sinceId,
    );

    let answered = 0;
    if (this.#haveBaseline) {
      // Somebody is talking to us, so poll fast for a while. Set before the
      // replies rather than after, so a slow payment does not eat the window
      // that was meant to catch the next message quickly.
      if (mentions.length > 0) this.#warmUntil = Date.now() + WARM_MS;

      const results = await Promise.all(this.#queues(mentions).map((queue) => this.#drain(queue)));
      answered = results.reduce((total, count) => total + count, 0);
    } else {
      this.#options.log(
        `baseline set at ${newestId ?? "nothing"}; ${mentions.length} earlier mentions left alone`,
      );
    }

    // Advanced even on a first run and even when nothing was answered, so the
    // baseline sticks and a mention we chose to ignore is not re-read forever.
    if (newestId) {
      this.#sinceId = newestId;
      this.#options.state.write({ sinceId: newestId });
    }
    this.#haveBaseline = true;

    return { read: mentions.length, answered, nextPollMs: this.#pace(rateLimit) };
  }

  /** Poll until stopped. */
  async start(): Promise<void> {
    this.#running = true;
    this.#options.log(
      `Selkie is watching @${this.#options.handle} on X${this.dryRun ? " (dry run, posting nothing)" : ""}`,
    );

    while (this.#running) {
      let wait = this.#options.pollMs;
      try {
        const { read, answered, nextPollMs } = await this.poll();
        this.#backoffMs = 0;
        wait = nextPollMs;
        if (read > 0) this.#options.log(`read ${read}, answered ${answered}, next look in ${round(wait)}s`);
      } catch (error) {
        await this.#absorb(error);
      }
      await this.#options.sleep(this.#backoffMs || wait);
    }
  }

  /**
   * How long to wait before looking again.
   *
   * Two questions, in order. Is anybody talking to us? If so the fast interval
   * applies, because the person who tweeted is staring at their screen waiting
   * for the answer, and a minute of silence reads as broken. If not, the slow
   * one does, because polling an empty timeline costs the same as polling a
   * busy one and buys nothing.
   *
   * Then: can we afford it? X reports what is left of the quota and when it
   * refills, so the fastest sustainable interval is simply the time remaining
   * divided by the reads remaining. Polling faster than that does not deliver
   * replies sooner, it spends the window early and then delivers none at all
   * until it reopens. Quicker than the quota allows is slower.
   *
   * Working it out from the headers rather than from a number in a config file
   * means this is right on whichever plan the account is on, including after it
   * changes, without anybody remembering to edit anything.
   */
  #pace(limit: RateLimit | null): number {
    const wanted = Date.now() < this.#warmUntil ? this.#options.activeMs : this.#options.pollMs;
    if (!limit) return wanted;

    const untilReset = limit.resetAt - Date.now();
    // The window has already rolled over, or the clocks disagree. Either way the
    // reading tells us nothing, so fall back rather than act on it.
    if (untilReset <= 0) return wanted;

    // Nothing left. Wait for the refill instead of spending the next call on a
    // 429, which costs a request and buys a rate limit.
    if (limit.remaining <= 0) return Math.min(untilReset + 1000, MAX_BACKOFF_MS);

    const affordable = untilReset / limit.remaining;
    return Math.min(Math.max(wanted, affordable), MAX_BACKOFF_MS);
  }

  /**
   * Mentions split into one queue per person.
   *
   * Different people are independent and go at once, so one slow payment does
   * not hold up everybody behind it in the same batch. The same person's
   * messages stay in order and strictly one at a time: two payments from one
   * sender share an idempotency key, and running them together would race that
   * guard rather than be caught by it.
   */
  #queues(mentions: Mention[]): Mention[][] {
    const byAuthor = new Map<string, Mention[]>();
    for (const mention of mentions) {
      const queue = byAuthor.get(mention.authorId);
      if (queue) queue.push(mention);
      else byAuthor.set(mention.authorId, [mention]);
    }
    return [...byAuthor.values()];
  }

  /** One person's messages, oldest first, one after another. */
  async #drain(queue: Mention[]): Promise<number> {
    let answered = 0;
    for (const mention of queue) {
      if (await this.#act(mention)) answered++;
    }
    return answered;
  }

  stop(): void {
    this.#running = false;
  }

  /** Handle one mention. Returns whether it produced a reply. */
  async #act(mention: Mention): Promise<boolean> {
    if (this.#seen.has(mention.id)) return false;
    this.#remember(mention.id);

    // Our own replies land in our own mentions. Answering them is an infinite
    // conversation with ourselves, billed by the post.
    if (mention.authorHandle.toLowerCase() === this.#options.handle.toLowerCase()) return false;

    const command = parseCommand(mention.text);
    if (!command) return false;

    const text = await respond(
      command,
      { platform: "x", subject: mention.authorId, username: mention.authorHandle },
      this.#options.selkie,
      {
        webUrl: this.#options.webUrl,
        self: this.#options.handle,
        onError: (error) => this.#options.log(`unexpected: ${describe(error)}`),
      },
    );
    if (!text) return false;

    if (this.dryRun) {
      this.#options.log(`[dry run] would reply to @${mention.authorHandle}: ${text}`);
      return true;
    }

    try {
      await this.#options.client.reply(text, mention.id);
      return true;
    } catch (error) {
      // A reply that will not post must not take the loop down with it, and
      // must not be retried into the same wall. The action already happened.
      this.#options.log(`could not reply to ${mention.id}: ${describe(error)}`);
      return false;
    }
  }

  /**
   * Turn a failed poll into a wait.
   *
   * A rate limit is not an error to log and charge past. X says when the window
   * reopens; anything else doubles the wait so a sustained outage is not also a
   * sustained bill.
   */
  async #absorb(error: unknown): Promise<void> {
    if (error instanceof XApiError && error.status === 429) {
      this.#backoffMs = Math.min(error.retryAfterMs ?? this.#nextBackoff(), MAX_BACKOFF_MS);
      this.#options.log(`rate limited by X, waiting ${Math.round(this.#backoffMs / 1000)}s`);
      return;
    }
    this.#backoffMs = this.#nextBackoff();
    this.#options.log(`poll failed: ${describe(error)}`);
  }

  #nextBackoff(): number {
    const next = this.#backoffMs === 0 ? this.#options.pollMs * 2 : this.#backoffMs * 2;
    return Math.min(next, MAX_BACKOFF_MS);
  }

  /** Bounded, because a worker meant to run for months cannot grow a set forever. */
  #remember(id: string): void {
    this.#seen.add(id);
    if (this.#seen.size > SEEN_LIMIT) {
      const oldest = this.#seen.values().next().value;
      if (oldest !== undefined) this.#seen.delete(oldest);
    }
  }
}

/**
 * A failure in one line, with the reason rather than the category.
 *
 * Node reports every network problem as "fetch failed" and hides the real one
 * underneath, which makes a name that will not resolve, a refused connection,
 * and a laptop that went to sleep all read identically in a log.
 */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  return cause instanceof Error ? `${error.message}: ${cause.message}` : error.message;
}

/** Milliseconds as seconds, for a log line a person reads. */
function round(ms: number): number {
  return Math.round(ms / 100) / 10;
}
