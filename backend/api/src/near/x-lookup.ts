/**
 * @username -> numeric X user id, so held money can wait for the person rather
 * than for the text of their handle (design 5.3).
 *
 * Optional: without `X_BEARER_TOKEN` every hold uses the username scheme, which
 * still works and is claimed the same way. A lookup that fails falls back the
 * same way rather than blocking a payment.
 */
export interface XUserLookup {
  idOf(username: string): Promise<string | null>;
}

const CACHE_MS = 10 * 60_000;

export class XApiUserLookup implements XUserLookup {
  readonly #cache = new Map<string, { id: string | null; until: number }>();

  constructor(
    private readonly bearerToken: string,
    private readonly apiUrl = "https://api.x.com",
  ) {}

  async idOf(username: string): Promise<string | null> {
    const key = username.toLowerCase();
    const cached = this.#cache.get(key);
    if (cached && cached.until > Date.now()) return cached.id;

    let id: string | null = null;
    try {
      // X API v2 user lookup by username (GET /2/users/by/username/:username).
      const response = await fetch(`${this.apiUrl}/2/users/by/username/${encodeURIComponent(key)}`, {
        headers: { authorization: `Bearer ${this.bearerToken}` },
        signal: AbortSignal.timeout(4_000),
      });
      if (response.ok) {
        const body = (await response.json()) as { data?: { id?: string } };
        id = body.data?.id && /^\d{1,20}$/.test(body.data.id) ? body.data.id : null;
      }
    } catch {
      id = null;
    }
    this.#cache.set(key, { id, until: Date.now() + CACHE_MS });
    return id;
  }
}

/** The lookup to use when no token is configured: always "unknown". */
export const noXLookup: XUserLookup = { idOf: async () => null };
