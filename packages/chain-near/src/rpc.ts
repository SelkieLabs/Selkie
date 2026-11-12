/**
 * NEAR RPC with a fallback.
 *
 * One endpoint is one point of failure, and sign-in reads the chain:
 * rpc.testnet.near.org was switched off on 12 Nov 2026 (it answers every call
 * with a 429 telling you to stop using it), and FastNear's free tier
 * rate-limits bursts. NEAR_RPC_URL takes a comma-separated list. Calls go to
 * the current endpoint and move to the next only when it is *unavailable*:
 * rate-limited, a 5xx, or no answer at all.
 *
 * A real answer is never retried elsewhere. "Account does not exist" is an
 * answer, and the code that asks reads it. near-api-js's FailoverRpcProvider
 * switches on every error and wraps them, which would turn that answer into a
 * different error and break those checks.
 */
import { JsonRpcProvider } from "near-api-js";

export function rpcUrls(value: string): string[] {
  return value
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

/** True when the endpoint, not the request, is the problem. */
export function endpointUnavailable(error: unknown): boolean {
  const e = error as { cause?: unknown; message?: unknown; name?: unknown } | null;
  const status = typeof e?.cause === "number" ? e.cause : null;
  if (status === 429 || status === 408 || (status !== null && status >= 500)) return true;
  const text = `${String(e?.name ?? "")} ${String(e?.message ?? "")}`;
  return /fetch failed|failed to fetch|FetchError|RetriesExceeded|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Too Many Requests/i.test(text);
}

/**
 * A JsonRpcProvider that fails over across `urls`. It is a Proxy over the
 * first provider so every caller (Account, views, scripts) keeps the type it
 * already uses.
 */
export function failoverProvider(urls: string[]): JsonRpcProvider {
  if (urls.length === 0) throw new Error("NEAR_RPC_URL is not set");
  const providers = urls.map((url) => new JsonRpcProvider({ url }));
  if (providers.length === 1) return providers[0]!;
  let current = 0;

  return new Proxy(providers[0]!, {
    get(_target, property) {
      const value = Reflect.get(providers[current]!, property);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const attempt = async (tried: number): Promise<unknown> => {
          const index = current;
          const provider = providers[index]!;
          try {
            return await (Reflect.get(provider, property) as (...a: unknown[]) => unknown).apply(provider, args);
          } catch (error) {
            if (!endpointUnavailable(error) || tried + 1 >= providers.length) throw error;
            // Another call may already have moved on; only advance from where this one was.
            if (current === index) current = (index + 1) % providers.length;
            return attempt(tried + 1);
          }
        };
        return attempt(0);
      };
    },
  });
}
