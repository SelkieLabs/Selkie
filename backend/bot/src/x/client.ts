import { createHmac, randomBytes } from "node:crypto";

/**
 * The X API, signed the way X still requires.
 *
 * Posting as @SelkiePay needs the account's own user tokens: the app-only bearer
 * can read the timeline but can never write to it. Those tokens are OAuth 1.0a,
 * so every call carries an HMAC-SHA1 signature over the method, the URL, and
 * every parameter, sorted. It is dated, and it is what works. User tokens also
 * do not expire, which is what makes them right for a worker meant to stay up.
 */

const API = "https://api.x.com/2";

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

export class XApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** When X told us to come back later, the moment it named. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "XApiError";
  }
}

export interface Mention {
  id: string;
  text: string;
  authorId: string;
  authorHandle: string;
  /** When it was posted, so a log can say how late we were to it. */
  createdAt?: string;
}

/**
 * What is left of the current quota, as X last reported it.
 *
 * X sends this on every response, not only on a refusal, which means the right
 * polling speed can be worked out instead of guessed. Guessing is what forces a
 * conservative fixed interval: too slow on a generous plan, and still too fast
 * on a tight one.
 */
export interface RateLimit {
  /** Reads left in this window. */
  remaining: number;
  /** When the window refills, as epoch milliseconds. */
  resetAt: number;
}

export class XClient {
  #rateLimit: RateLimit | null = null;

  constructor(private readonly credentials: XCredentials) {}

  /** The quota as of the last call, or null if X has not said. */
  get rateLimit(): RateLimit | null {
    return this.#rateLimit;
  }

  /** Our own numeric id, needed to read our mentions. */
  async selfId(handle: string): Promise<string> {
    const response = await this.get<{ data?: { id?: string } }>(
      `/users/by/username/${encodeURIComponent(handle.replace(/^@/, ""))}`,
    );
    const id = response.data?.id;
    if (!id) throw new XApiError(`Could not resolve @${handle}`, 404);
    return id;
  }

  /**
   * Mentions newer than `sinceId`, oldest first.
   *
   * Oldest first so a burst of tweets is answered in the order it was written,
   * which is the order the person who wrote it expects.
   */
  async mentions(
    userId: string,
    sinceId: string | null,
    max = 20,
  ): Promise<{ mentions: Mention[]; newestId: string | null; rateLimit: RateLimit | null }> {
    const query: Record<string, string | number> = {
      max_results: Math.max(5, Math.min(100, max)),
      expansions: "author_id",
      "tweet.fields": "author_id,created_at",
      "user.fields": "username",
    };
    if (sinceId) query.since_id = sinceId;

    const response = await this.get<{
      data?: { id: string; text: string; author_id: string; created_at?: string }[];
      includes?: { users?: { id: string; username: string }[] };
      meta?: { newest_id?: string };
    }>(`/users/${userId}/mentions`, query);

    const handles = new Map((response.includes?.users ?? []).map((user) => [user.id, user.username]));
    const mentions = (response.data ?? [])
      .map((tweet) => {
        const authorHandle = handles.get(tweet.author_id);
        // No author means no way to know who we would be paying from. Skipped
        // rather than guessed.
        return authorHandle
          ? {
              id: tweet.id,
              text: tweet.text,
              authorId: tweet.author_id,
              authorHandle,
              // Spread rather than assigned, because the field is optional and
              // an explicit undefined is not the same as an absent one here.
              ...(tweet.created_at ? { createdAt: tweet.created_at } : {}),
            }
          : null;
      })
      .filter((mention): mention is Mention => mention !== null)
      .reverse();

    return { mentions, newestId: response.meta?.newest_id ?? null, rateLimit: this.#rateLimit };
  }

  /** Post a public reply under a tweet. */
  async reply(text: string, inReplyToId: string): Promise<void> {
    await this.post("/tweets", { text, reply: { in_reply_to_tweet_id: inReplyToId } });
  }

  async get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    const url = `${API}${path}`;
    const search = Object.entries(query)
      .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
      .join("&");

    return this.#send<T>(search ? `${url}?${search}` : url, {
      method: "GET",
      headers: { authorization: this.#authorization("GET", url, query) },
    });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${API}${path}`;
    return this.#send<T>(url, {
      method: "POST",
      headers: {
        authorization: this.#authorization("POST", url),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  async #send<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    this.#rateLimit = readRateLimit(response) ?? this.#rateLimit;

    const payload = (await response.json().catch(() => ({}))) as T & { detail?: string; title?: string };

    if (!response.ok) {
      throw new XApiError(
        payload.detail ?? payload.title ?? `X returned ${response.status}`,
        response.status,
        retryAfterMs(response),
      );
    }
    return payload;
  }

  /**
   * The OAuth 1.0a Authorization header.
   *
   * The signature covers the method, the base URL, and every oauth_* and query
   * parameter sorted by name. A JSON body is not part of it, which is why the
   * same routine serves both the read and the post.
   */
  #authorization(method: string, url: string, query: Record<string, string | number> = {}): string {
    const oauth: Record<string, string> = {
      oauth_consumer_key: this.credentials.apiKey,
      oauth_nonce: randomBytes(16).toString("hex"),
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: this.credentials.accessToken,
      oauth_version: "1.0",
    };

    const parameters = { ...oauth, ...query };
    const parameterString = Object.keys(parameters)
      .sort()
      .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(parameters[key] as string | number)}`)
      .join("&");

    const base = [
      method.toUpperCase(),
      encodeRfc3986(url),
      encodeRfc3986(parameterString),
    ].join("&");
    const key = `${encodeRfc3986(this.credentials.apiSecret)}&${encodeRfc3986(this.credentials.accessSecret)}`;
    oauth.oauth_signature = createHmac("sha1", key).update(base).digest("base64");

    return `OAuth ${Object.keys(oauth)
      .sort()
      .map((name) => `${encodeRfc3986(name)}="${encodeRfc3986(oauth[name] as string)}"`)
      .join(", ")}`;
  }
}

/**
 * RFC 3986 percent-encoding.
 *
 * encodeURIComponent leaves !*'() alone and OAuth wants them encoded, so without
 * this the signature base differs from the one X rebuilds and every call fails
 * with an unhelpful 401.
 */
export function encodeRfc3986(value: string | number): string {
  return encodeURIComponent(String(value)).replace(
    /[!*'()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The quota headers, if this response carried them.
 *
 * Both must be present and readable to be worth anything: a remaining count
 * with no reset time cannot be turned into a rate, and half a reading would
 * make the poll interval swing on noise.
 */
function readRateLimit(response: Response): RateLimit | null {
  const remaining = Number(response.headers.get("x-rate-limit-remaining"));
  const reset = Number(response.headers.get("x-rate-limit-reset"));
  if (!Number.isFinite(remaining) || !Number.isFinite(reset) || reset <= 0) return null;

  return { remaining: Math.max(0, remaining), resetAt: reset * 1000 };
}

/**
 * How long X wants us to wait, from whichever header it used.
 *
 * X answers a rate limit with a reset timestamp rather than a delay, and reading
 * it is the difference between backing off once and hammering a closed door
 * until the quota is gone.
 */
function retryAfterMs(response: Response): number | undefined {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }

  const reset = response.headers.get("x-rate-limit-reset");
  if (reset) {
    const at = Number(reset) * 1000;
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  return undefined;
}
