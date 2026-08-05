import { parseCommand } from "../parse";
import { respond } from "../respond";
import type { SelkieClient } from "../selkie";
import type { StateStore } from "../state";
import { XApiError } from "./client";
import type { Mention, XClient } from "./client";

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
  pollMs?: number;
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
      pollMs: 30_000,
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

    const { mentions, newestId } = await this.#options.client.mentions(this.#userId, this.#sinceId);

    let answered = 0;
    if (this.#haveBaseline) {
      for (const mention of mentions) {
        if (await this.#act(mention)) answered++;
      }
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

    return { read: mentions.length, answered };
  }

  /** Poll until stopped. */
  async start(): Promise<void> {
    this.#running = true;
    this.#options.log(
      `Selkie is watching @${this.#options.handle} on X${this.dryRun ? " (dry run, posting nothing)" : ""}`,
    );

    while (this.#running) {
      try {
        const { read, answered } = await this.poll();
        this.#backoffMs = 0;
        if (read > 0) this.#options.log(`read ${read}, answered ${answered}`);
      } catch (error) {
        await this.#absorb(error);
      }
      await this.#options.sleep(this.#backoffMs || this.#options.pollMs);
    }
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
