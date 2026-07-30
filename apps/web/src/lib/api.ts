// Typed client for the Selkie server. The browser never holds a ledger token:
// every Canton call happens server-side, keyed to the session cookie.

export type Me = {
  handle: string;
  name?: string;
  avatar?: string | null;
  walletReady: boolean;
  /** Your own Canton party — the real address behind your handle. */
  address?: string | null;
  assets: string[];
};

export type Balances = { handle: string; balances: Record<string, number> };

export type Activity = {
  id?: string;
  ts: string;
  type: "send" | "reward" | "deposit";
  from: string;
  to: string;
  asset: string;
  amount: number;
  memo?: string;
  onboarded?: boolean;
  direction: "in" | "out";
};

export type SendResult = {
  from: string;
  to: string;
  asset: string;
  amount: number;
  memo: string;
  onboarded: boolean;
  id?: string;
};

export type CampaignResult = {
  paid: number;
  onboarded: number;
  failed: { handle: string; error: string }[];
  results: { handle: string; ok: boolean; onboarded?: boolean }[];
};

/** An open ask. It holds no money: approving it is what moves anything. */
export type PaymentRequest = {
  cid: string;
  from: string;
  to: string;
  asset: string;
  amount: number;
  memo: string;
};

export type Requests = { incoming: PaymentRequest[]; outgoing: PaymentRequest[] };

export type PublicAccount = {
  handle: string;
  exists: boolean;
  canReceive: true;
};

/**
 * Where outside money comes in. Every token now lands at your OWN Canton party,
 * so there is a single personal address that receives both CC and cBTC, and
 * `pending` is whatever is already waiting there, per asset.
 */
export type Deposit =
  | { active: false }
  | {
      active: true;
      address: string;
      network: string;
      assets: string[];
      pending: { asset: string; amount: number; sender: string }[];
    };

export type DepositClaim = {
  claimed: { asset: string; amount: number; sender: string; updateId: string; id: string }[];
  total: number;
};

/** Your balance's real on-ledger backing: unlocked holdings at your own party. */
export type Reserve =
  | { active: false }
  | {
      active: true;
      network: string;
      address: string;
      holdings: { asset: string; amount: number }[];
      asOf: string;
    };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export const api = {
  me: () => request<Me>("/api/me"),
  balance: () => request<Balances>("/api/balance"),
  history: () => request<{ entries: Activity[] }>("/api/history"),

  send: (payload: { to: string; asset: string; amount: number; memo?: string }) =>
    request<SendResult>("/api/send", { method: "POST", body: JSON.stringify(payload) }),

  campaign: (payload: { winners: string[]; asset: string; amountEach: number; memo?: string }) =>
    request<CampaignResult>("/api/campaign", { method: "POST", body: JSON.stringify(payload) }),

  deposit: () => request<Deposit>("/api/deposit"),

  claimDeposits: () => request<DepositClaim>("/api/deposit/claim", { method: "POST" }),

  requests: () => request<Requests>("/api/requests"),

  askFor: (payload: { from: string; asset: string; amount: number; memo?: string }) =>
    request<PaymentRequest>("/api/request", { method: "POST", body: JSON.stringify(payload) }),

  answerRequest: (payload: { cid: string; action: "approve" | "decline" | "cancel" }) =>
    request<{ ok: true }>("/api/requests/answer", { method: "POST", body: JSON.stringify(payload) }),

  account: (handle: string) =>
    request<PublicAccount>(`/api/account/${encodeURIComponent(handle.replace(/^@/, ""))}`),

  transaction: (id: string) => request<Activity>(`/api/tx/${encodeURIComponent(id)}`),

  reserve: () => request<Reserve>("/api/reserve"),
};
