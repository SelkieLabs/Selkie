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

export interface XWorkerOptions {
  client: XClient;
  selkie: SelkieClient;
  /** The bot's own handle, without the @. */
  handle: string;
  /** Where people are pointed to open their wallet. */
  webUrl: string;
  state: StateStore;
  /** The slowest it will poll, used when X reports no quota to work from. */
  pollMs?: number;
  /** The fastest it will poll, however generous the quota looks. */
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

  constructor(options: XWorkerOptions) {
    this.#options = {
      pollMs: 15_000,
      activeMs: 3_000,
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
      if (mentions.length > 0) this.#options.log(`read ${mentions.length}${lateness(mentions)}`);

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
        if (read > 0) this.#options.log(`answered ${answered}, next look in ${round(wait)}s`);
      } catch (error) {
        await this.#absorb(error);
      }
      await this.#options.sleep(this.#backoffMs || wait);
    }
  }

  /**
   * How long to wait before looking again: as fast as the quota can sustain.
   *
   * X reports what is left of the window and when it refills, so the fastest
   * sustainable interval is simply the time remaining divided by the reads
   * remaining. Polling quicker than that does not deliver replies sooner; it
   * spends the window early and then delivers none at all until it reopens.
   * The arithmetic also corrects itself: poll a little fast and the remaining
   * count falls faster, which stretches the next interval back out.
   *
   * There used to be a second question here, whether anybody was talking to us,
   * with a slow interval when nobody was. That was a mistake, and an expensive
   * one to find: it made the SECOND message of a conversation fast and the
   * first one slow, and every conversation starts with a first message. Someone
   * posting at Selkie after a quiet hour waited the idle interval every time,
   * which is exactly the moment the product is being judged.
   *
   * Nothing is saved by going slower than the quota allows, because the window
   * refills on a clock whether it was spent or not. So there is one interval
   * now, and it is the fast one.
   */
  #pace(limit: RateLimit | null): number {
    // No headers to work from: fall back to the configured slowest rather than
    // guess at a plan we have not been told about.
    if (!limit) return this.#options.pollMs;

    const untilReset = limit.resetAt - Date.now();
    // The window has already rolled over, or the clocks disagree. Either way the
    // reading tells us nothing, so fall back rather than act on it.
    if (untilReset <= 0) return this.#options.pollMs;

    // Nothing left. Wait for the refill instead of spending the next call on a
    // 429, which costs a request and buys a rate limit.
    if (limit.remaining <= 0) return Math.min(untilReset + 1000, MAX_BACKOFF_MS);

    const affordable = untilReset / limit.remaining;
    return clamp(affordable, this.#options.activeMs, this.#options.pollMs);
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

/**
 * How long the oldest message in a batch had been sitting there.
 *
 * The one number that separates "we polled too slowly" from "X was slow to show
 * it to us", which look identical from the outside and have completely
 * different fixes. Without it, a slow reply is a matter of opinion.
 */
function lateness(mentions: Mention[]): string {
  const ages = mentions
    .map((mention) => (mention.createdAt ? Date.now() - Date.parse(mention.createdAt) : NaN))
    .filter((age) => Number.isFinite(age));
  if (ages.length === 0) return "";

  return `, oldest posted ${round(Math.max(...ages))}s ago`;
}

/** Keep a value inside its bounds, whichever way round they were given. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}
