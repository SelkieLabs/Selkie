/**
 * The only place this app talks to the Selkie API.
 *
 * Every request carries the identity provider's access token as a bearer token;
 * Selkie issues no session of its own. The token arrives through a provider
 * function so nothing here has to know that Privy exists, which is what keeps
 * this file framework-free and swappable.
 */

export interface Handle {
  platform: "x" | "telegram";
  username: string;
}

export interface Money {
  /** Decimal string. Money is never a float, not even in the UI. */
  amount: string;
  asset: string;
}

export interface Identity {
  provider: "google" | "x" | "telegram";
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface User {
  id: string;
  address: string;
  /** Every handle this person can be paid at. Empty means "not payable yet". */
  handles: Handle[];
  identities: Identity[];
}

/** Money that was waiting for a handle and landed the moment they proved it. */
export interface ClaimOutcome {
  handle: Handle;
  released: number;
  amounts: Money[];
  ref?: string;
}

export interface Session {
  status: "created" | "signed-in";
  user: User;
  claimed: ClaimOutcome[];
}

/** The API's polite "we have never seen you, shall we make you a wallet?". */
export interface NoAccount {
  status: "no-account";
  message: string;
}

export interface MergeRequired {
  status: "merge-required";
  message: string;
  mergeCandidate: { userId: string; address: string };
}

export interface Linked {
  status: "linked";
  user: User;
  claimed: ClaimOutcome[];
}

/** Who you are about to pay, resolved before you pay them. */
export interface Recipient {
  handle: Handle;
  /** False just means they have not joined yet. It is still a valid destination. */
  onSelkie: boolean;
  isYou: boolean;
  displayName?: string;
  avatarUrl?: string;
}

export interface SendResult {
  status: string;
  ref?: string;
  message: string;
  waitingToBeClaimed: boolean;
}

export interface Quote {
  from: Money;
  to: Money;
}

export interface ConvertResult {
  status: string;
  ref: string;
  received: Money;
  message: string;
}

/** The address to put money into, once it can actually receive it. */
export interface ReceiveDetails {
  address: string;
  /** Asset codes this wallet can accept right now. */
  accepts: string[];
  handles: Handle[];
}

export type RequestStatus = "pending" | "paid" | "declined" | "cancelled";

export interface MoneyRequest {
  id: string;
  fromHandle: Handle;
  toHandle: Handle;
  amount: Money;
  note?: string;
  status: RequestStatus;
  createdAt: string;
  settledAt?: string;
}

export interface BatchResult {
  status: string;
  message: string;
  results: { handle: string; sent: boolean; waitingToBeClaimed?: boolean }[];
}

export type ActivityKind = "send" | "receive" | "claim" | "swap" | "airtime" | "bill" | "cashout";

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  amount: Money;
  counterparty?: string;
  status: "pending" | "confirmed" | "failed";
  at: string;
  ref?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider = async () => null;

/** Called once by the auth provider. Everything else just calls the api. */
export function setTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

async function request<T>(path: string, init: RequestInit & { expect?: number[] } = {}): Promise<T> {
  const token = await tokenProvider();
  const { expect = [], ...rest } = init;

  const response = await fetch(`/api${path}`, {
    ...rest,
    headers: {
      ...(rest.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...rest.headers,
    },
  });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok || expect.includes(response.status)) return body as T;

  // The server writes its messages for people. Show what it said, never a code.
  const message =
    typeof body.error === "string"
      ? body.error
      : typeof body.message === "string"
        ? body.message
        : "Something went wrong. Try that again.";
  throw new ApiError(response.status, message, body);
}

const json = (value: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(value) });

export const api = {
  /**
   * Sign in. An identity we have never seen comes back as `no-account` rather
   * than quietly becoming a second wallet for someone who already has one.
   */
  async session(options: { createAccount?: boolean } = {}): Promise<Session | NoAccount> {
    const token = await tokenProvider();
    return request<Session | NoAccount>("/auth/session", {
      ...json({ token, createAccount: options.createAccount === true }),
      expect: [404],
    });
  },

  /**
   * Attach another identity. This is the moment money that was waiting for a
   * handle becomes theirs, so the response carries whatever just landed.
   */
  async link(token: string): Promise<Linked | MergeRequired> {
    return request<Linked | MergeRequired>("/auth/link", {
      ...json({ token }),
      expect: [409],
    });
  },

  /** Confirmed merge. A separate call because it moves money. */
  async merge(fromUserId: string): Promise<{ status: "merged"; user: User }> {
    return request("/auth/merge", json({ fromUserId }));
  },

  async me(): Promise<{ user: User; balances: Money[] }> {
    return request("/me");
  },

  /** Resolve a handle for the confirm screen. */
  async recipient(username: string, platform: "x" | "telegram" = "x"): Promise<Recipient> {
    const handle = username.trim().replace(/^@+/, "");
    return request(`/handles/${encodeURIComponent(handle)}?platform=${platform}`);
  },

  /**
   * The address to fund the wallet at.
   *
   * A POST, not a GET, because it changes something: it makes the wallet real on
   * the ledger and opens it to the assets we support. An address handed out
   * before that is an address that bounces money back.
   */
  async receive(): Promise<ReceiveDetails> {
    return request("/me/receive", { method: "POST" });
  },

  async send(input: {
    to: string;
    amount: string;
    asset?: string;
    platform?: "x" | "telegram";
    note?: string;
  }): Promise<SendResult> {
    return request("/payments/send", json(input));
  },

  /** Pay a list of people the same amount each. */
  async payMany(input: {
    to: string[];
    amount: string;
    asset?: string;
    note?: string;
  }): Promise<BatchResult> {
    return request("/payments/batch", json(input));
  },

  async requests(): Promise<{ incoming: MoneyRequest[]; outgoing: MoneyRequest[] }> {
    return request("/requests");
  },

  /** Ask someone for money. Moves nothing until they agree. */
  async ask(input: {
    from: string;
    amount: string;
    asset?: string;
    note?: string;
  }): Promise<{ status: string; request: MoneyRequest; message: string }> {
    return request("/requests", json(input));
  },

  async payRequest(id: string): Promise<{ status: string; message: string }> {
    return request(`/requests/${encodeURIComponent(id)}/pay`, { method: "POST" });
  },

  async declineRequest(id: string): Promise<{ status: string }> {
    return request(`/requests/${encodeURIComponent(id)}/decline`, { method: "POST" });
  },

  async cancelRequest(id: string): Promise<{ status: string }> {
    return request(`/requests/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  },

  async quote(from: string, to: string, amount: string): Promise<Quote> {
    const query = new URLSearchParams({ from, to, amount });
    return request(`/payments/convert/quote?${query}`);
  },

  async convert(from: string, to: string, amount: string): Promise<ConvertResult> {
    return request("/payments/convert", json({ from, to, amount }));
  },

  async activity(limit = 50): Promise<ActivityEntry[]> {
    const { entries } = await request<{ entries: ActivityEntry[] }>(`/activity?limit=${limit}`);
    return entries;
  },
};
