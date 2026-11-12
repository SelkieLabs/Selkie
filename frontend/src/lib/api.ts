/**
 * The only place this app talks to the Selkie API.
 *
 * Every request carries the identity provider's access token as a bearer token;
 * Selkie issues no session of its own. The token arrives through a provider
 * function so nothing here has to know that Privy exists, which is what keeps
 * this file framework-free and swappable.
 */

import type { PreparedDelegate } from "@selkie/chain-near/browser";

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
  /** NEAR: their account, when they are on Selkie. Money goes straight there. */
  nearAccount?: string;
  /** NEAR: who the escrow will hold the money for, when they are not. */
  recipientKey?: string;
  /** NEAR: `x-id` survives a rename on X; `username` is the fallback. */
  scheme?: "x-id" | "username";
}

export interface SendResult {
  status: string;
  ref?: string;
  message: string;
  waitingToBeClaimed: boolean;
  /** NEAR: the transaction on the explorer. */
  explorer?: string;
  /** NEAR: the escrow payment id, while it waits. */
  claimRef?: string;
  /** NEAR pay many: how each person came out. */
  results?: BatchResult["results"];
  /** NEAR cash-out to another chain: follow it with `api.near.intents.status`. */
  intents?: { depositAddress: string };
  /** NEAR cash-out to a bank: follow it with `api.near.bank.status`. */
  bank?: {
    orderId: string;
    depositAddress: string;
    currency: string;
    fiatAmount: string;
    institutionName: string;
    accountLast4: string;
  };
}

/** A bank (or mobile-money service) Paycrest can pay into. */
export interface BankInstitution {
  name: string;
  code: string;
  /** "bank" or "mobile_money". */
  type: string;
}

/** What a bank cash-out would pay. Amounts are decimal strings. */
export interface BankQuote {
  /** NEAR mainnet. */
  live: boolean;
  /** Confirming makes a real payout. */
  payoutsOn: boolean;
  /** Why it is only a preview, when it is. */
  note?: string;
  currency: string;
  /** USDC the payout is for. */
  amount: string;
  /** Local currency per 1 USDC. */
  rate: string;
  /** About what reaches the bank. */
  fiatAmount: string;
  /** About what leaves your account: the payout plus the swap to get it there. */
  sendAbout?: string;
  /** The most the confirmed payout may take. */
  sendAtMost?: string;
  /** Seconds. */
  timeEstimate?: number;
}

export type BankStage = "swapping" | "paying" | "paid" | "back-to-you" | "returning" | "returned" | "expired" | "late";

export interface BankStatus {
  orderId: string;
  stage: BankStage;
  done: boolean;
  paycrest: { status: string; rate?: string; amount?: string; fiatAmount?: string; txHash?: string } | null;
  intents: { status: IntentsStatusName; refundReason?: string; originTxs: string[]; destinationTxs: string[] } | null;
}

/** A stablecoin on another chain that NEAR Intents can bring in or take out. */
export interface ChainAsset {
  assetId: string;
  symbol: string;
  /** 1Click's chain name: "base", "tron", ... */
  blockchain: string;
  /** For people: "Base", "Tron", ... */
  chainName: string;
  decimals: number;
}

/** A NEAR Intents price. Amounts are already formatted for people. */
export interface IntentsQuote {
  direction: "in" | "out";
  /** Testnet: a real price, but nothing can be deposited. */
  preview: boolean;
  asset: ChainAsset;
  amountIn: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  minAmountOutFormatted?: string;
  /** Seconds. */
  timeEstimate?: number;
  /** Money in, on mainnet: where to send it from the other chain. */
  depositAddress?: string;
  deadline?: string;
}

export type IntentsStatusName =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED";

export interface IntentsStatus {
  status: IntentsStatusName;
  /** Nothing more will happen: it arrived, came back, or failed. */
  done: boolean;
  amountInFormatted?: string;
  amountOutFormatted?: string;
  refundReason?: string;
  /** Explorer links on each side. */
  originTxs: string[];
  destinationTxs: string[];
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

/** Someone already on Selkie, offered while a handle is typed into Send. */
export interface HandleSuggestion {
  username: string;
  displayName?: string;
  avatarUrl?: string;
  nearAccount?: string;
}

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
  /**
   * The other side as a handle, when it was one. `counterparty` reads "@amaka"
   * with no platform, and that is not enough to pay them again: @amaka on X is
   * a different person from @amaka on Telegram.
   */
  counterpartyHandle?: Handle;
  /** NEAR: their X photo, when they have signed in to Selkie. */
  counterpartyAvatar?: string;
  /** `returned` is money that waited for someone who never came, taken back. */
  status: "pending" | "confirmed" | "failed" | "returned";
  at: string;
  ref?: string;
  /** The escrow's id for money still waiting. Only these can be taken back. */
  claimRef?: string;
  /** When it can be taken back, as an ISO timestamp. */
  refundableAt?: string;
}

/** NEAR: where this account lives on chain. */
export interface NearAccountInfo {
  network: "testnet" | "mainnet";
  accountId: string;
  explorerUrl: string;
}

export interface Me {
  user: User;
  balances: Money[];
  near?: NearAccountInfo;
}

/**
 * NEAR: exactly what the user's key is about to sign, as the backend prepared
 * it. The relayer refuses anything that differs from this by a single byte.
 */
/** A NEAR account looked up before paying it. */
export interface AccountLookup {
  accountId: string;
  /** A contract may have no way to send USDC back out. */
  kind: "missing" | "wallet" | "contract";
  onSelkie: boolean;
  isYou: boolean;
  warning?: string;
}

export interface PreparedPayment {
  prepareId: string;
  delegate: PreparedDelegate;
  intent:
    | { kind: "send"; to: Handle; amount: Money }
    | { kind: "hold"; to: Handle; amount: Money; scheme: "x-id" | "username" }
    | { kind: "refund"; claimRef: string; amount: Money };
}

/**
 * NEAR: the "Send from X" pocket. A small balance the X bot may spend from when
 * its owner tweets, never more than the daily limit. Decimal USDC ("12.5").
 */
export interface Pocket {
  balance: string;
  dailyCap: string;
  spentToday: string;
  leftToday: string;
}

export interface PocketInfo {
  /** False when this server runs no pocket contract. */
  enabled: boolean;
  contract: string | null;
  /** The X account to tweet at, without the @. */
  bot: string;
  /** Null until the first top-up. */
  pocket: Pocket | null;
}

/** NEAR: the proof behind "Selkie holds no key". */
export interface AccountKeys {
  accountId: string;
  explorerUrl: string;
  keys: { publicKey: string; fullAccess: boolean; heldBy: "you" | "selkie" | "unknown" }[];
  selkieHoldsKey: boolean;
}

export interface EmailStatus {
  /** False when the server has no way to send email. */
  available: boolean;
  email: string | null;
  verified: boolean;
  /** A code was sent and has not come back yet. */
  pending: boolean;
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

async function request<T>(
  path: string,
  init: RequestInit & { expect?: number[]; idempotencyKey?: string } = {},
): Promise<T> {
  const token = await tokenProvider();
  const { expect = [], idempotencyKey, ...rest } = init;

  const headers = {
    ...(rest.body ? { "content-type": "application/json" } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    ...rest.headers,
  };

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...rest, headers });
  } catch {
    // fetch only throws when there was never an answer: no signal, no server.
    // Left alone it surfaces as a raw TypeError, which says nothing to anyone.
    throw new ApiError(0, "Cannot reach Selkie. Check your connection and try again.");
  }

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

/**
 * One key per intent to move money.
 *
 * A phone that loses signal mid-request, a double-tap, a retry: without this the
 * money goes twice and the second payment is indistinguishable from a deliberate
 * one.
 *
 * The key belongs to the *intent*, not the request, so it is minted where the
 * intent is formed — the moment a confirm screen opens — and reused by every
 * attempt at that same payment. Minting one inside `send()` would give a
 * double-tap two different keys and defeat the entire point. Where a stable id
 * already exists (a request, an escrowed payment) that id is the key.
 */
export const newIdempotencyKey = (): string => crypto.randomUUID();

export const api = {
  /** Which chain the API serves. The NEAR API says `chain: "near"`; the Stellar one says nothing. */
  async health(): Promise<{ ok: boolean; chain?: string; network?: string }> {
    return request("/health");
  },

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

  async me(): Promise<Me> {
    return request("/me");
  },

  /** People on Selkie whose X handle matches what is being typed (from 3 letters, NEAR only). */
  async searchHandles(text: string): Promise<{ matches: HandleSuggestion[] }> {
    return request(`/handles?q=${encodeURIComponent(text.trim().replace(/^@+/, ""))}`);
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

  async send(
    input: {
      to: string;
      amount: string;
      asset?: string;
      platform?: "x" | "telegram";
      note?: string;
    },
    idempotencyKey?: string,
  ): Promise<SendResult> {
    return request("/payments/send", { ...json(input), idempotencyKey });
  },

  /** Pay a list of people the same amount each. */
  async payMany(
    input: {
      to: string[];
      amount: string;
      asset?: string;
      platform?: "x" | "telegram";
      note?: string;
    },
    idempotencyKey?: string,
  ): Promise<BatchResult> {
    return request("/payments/batch", { ...json(input), idempotencyKey });
  },

  async requests(): Promise<{ incoming: MoneyRequest[]; outgoing: MoneyRequest[] }> {
    return request("/requests");
  },

  /** Ask someone for money. Moves nothing until they agree. */
  async ask(input: {
    from: string;
    amount: string;
    asset?: string;
    platform?: "x" | "telegram";
    note?: string;
  }): Promise<{ status: string; request: MoneyRequest; message: string }> {
    return request("/requests", json(input));
  },

  async payRequest(id: string): Promise<{ status: string; message: string }> {
    // The request's own id is the intent, so it is also the key.
    return request(`/requests/${encodeURIComponent(id)}/pay`, {
      method: "POST",
      idempotencyKey: `request-pay-${id}`,
    });
  },

  async declineRequest(id: string): Promise<{ status: string }> {
    return request(`/requests/${encodeURIComponent(id)}/decline`, { method: "POST" });
  },

  async cancelRequest(id: string): Promise<{ status: string }> {
    return request(`/requests/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  },

  /**
   * Take back money that waited for someone who never came. Only the sender
   * can, and only once the wait is over.
   */
  async refund(claimRef: string): Promise<{ status: string; message: string }> {
    return request(`/payments/${encodeURIComponent(claimRef)}/refund`, {
      method: "POST",
      idempotencyKey: `refund-${claimRef}`,
    });
  },

  async quote(from: string, to: string, amount: string): Promise<Quote> {
    const query = new URLSearchParams({ from, to, amount });
    return request(`/payments/convert/quote?${query}`);
  },

  async convert(
    from: string,
    to: string,
    amount: string,
    idempotencyKey?: string,
  ): Promise<ConvertResult> {
    return request("/payments/convert", { ...json({ from, to, amount }), idempotencyKey });
  },

  async activity(limit = 50): Promise<ActivityEntry[]> {
    const { entries } = await request<{ entries: ActivityEntry[] }>(`/activity?limit=${limit}`);
    return entries;
  },

  /**
   * Email notices when money comes in. The address is proven with a six-digit
   * code before anything else is sent to it.
   */
  email: {
    async status(): Promise<EmailStatus> {
      return request("/email");
    },
    async start(email: string): Promise<EmailStatus> {
      return request("/email", json({ email }));
    },
    async verify(code: string): Promise<EmailStatus> {
      return request("/email/verify", json({ code }));
    },
    async remove(): Promise<EmailStatus> {
      return request("/email/remove", { method: "POST" });
    },
    /** From the link in an email: no sign-in, the signed link is the proof. */
    async unsubscribe(userId: string, token: string): Promise<{ stopped: true }> {
      const query = new URLSearchParams({ u: userId, t: token });
      return request(`/email/unsubscribe?${query}`, { method: "POST" });
    },
  },

  /** Notifications when money comes in (Web Push). See lib/push.ts. */
  push: {
    async key(): Promise<{ publicKey: string | null }> {
      return request("/push/key");
    },
    async subscribe(subscription: PushSubscriptionJSON): Promise<{ subscribed: true }> {
      return request("/push/subscribe", json(subscription));
    },
    async unsubscribe(endpoint: string): Promise<{ subscribed: false }> {
      return request("/push/unsubscribe", json({ endpoint }));
    },
  },

  /**
   * NEAR mode. Money moves in three steps: the backend prepares the exact
   * action, the user's own key signs it in the browser, and Selkie's relayer
   * pays the gas and submits it. `useNearPay` strings them together.
   */
  near: {
    async prepareSend(input: { to: string; amount: string; note?: string }): Promise<PreparedPayment> {
      return request("/near/payments/prepare", json(input));
    },

    /**
     * Any NEAR account, by name: a friend's wallet or an exchange deposit.
     * `cashout` only changes how it shows in the feed.
     */
    async prepareTransfer(input: {
      toAccount: string;
      amount: string;
      note?: string;
      purpose?: "send" | "cashout";
      /** They saw the contract warning and still want to pay it. */
      toContract?: boolean;
    }): Promise<PreparedPayment> {
      return request("/near/payments/prepare", json(input));
    },

    /** Several handles, the same amount each, one signature. */
    async preparePayMany(input: { toMany: string[]; amount: string; note?: string }): Promise<PreparedPayment> {
      return request("/near/payments/prepare", json(input));
    },

    /** A request someone sent you, for exactly the amount it asks. */
    async preparePayRequest(id: string): Promise<PreparedPayment> {
      return request("/near/payments/prepare", json({ requestId: id }));
    },

    /** Take back money that waited for someone who never came. */
    async prepareRefund(claimRef: string): Promise<PreparedPayment> {
      return request("/near/payments/prepare", json({ refundId: claimRef }));
    },

    /**
     * A prepare can be relayed once. A retry or double-tap after the first one
     * landed is refused by the server, so the money cannot go twice.
     */
    async relay(prepareId: string, signedDelegate: string): Promise<SendResult> {
      return request("/near/relay", json({ prepareId, signedDelegate }));
    },

    async keys(): Promise<AccountKeys> {
      return request("/near/account/keys");
    },

    /**
     * The X pocket. Topping up, withdrawing and changing the daily limit are
     * signed by the user's own key like any other payment; only `pocket_send`
     * belongs to the bot, and it can only reach Selkie accounts.
     */
    pocket: {
      async get(): Promise<PocketInfo> {
        return request("/near/pocket");
      },
      /** Move USDC from the account into the pocket; `dailyCap` sets the limit too. */
      async prepareTopUp(input: { amount: string; dailyCap?: string }): Promise<PreparedPayment> {
        return request("/near/payments/prepare", json({ pocket: { action: "top_up", ...input } }));
      },
      /** Back to the account. No amount means everything. */
      async prepareWithdraw(input: { amount?: string } = {}): Promise<PreparedPayment> {
        return request("/near/payments/prepare", json({ pocket: { action: "withdraw", ...input } }));
      },
      async prepareSetCap(input: { dailyCap: string }): Promise<PreparedPayment> {
        return request("/near/payments/prepare", json({ pocket: { action: "set_cap", ...input } }));
      },
    },

    /** What a NEAR account name points at, before paying it. */
    async account(accountId: string): Promise<AccountLookup> {
      return request(`/near/accounts/${encodeURIComponent(accountId)}`);
    },

    /**
     * USDC out to another chain. The server quotes it at this moment and
     * prepares a transfer to that quote's deposit address; the browser only
     * says which coin, how much and where. Mainnet only.
     */
    async prepareChainCashOut(input: {
      amount: string;
      toChain: { assetId: string; address: string };
    }): Promise<PreparedPayment> {
      return request("/near/payments/prepare", json(input));
    },

    /**
     * USDC out to a bank account. The server makes a Paycrest order and a NEAR
     * Intents quote that pays it at this moment; `maxSend` is the most the
     * person agreed to send. Mainnet only.
     */
    async prepareBankCashOut(input: {
      amount: string;
      toBank: { currency: string; institution: string; accountIdentifier: string; accountName: string; maxSend: string };
    }): Promise<PreparedPayment> {
      return request("/near/payments/prepare", json(input));
    },

    /** Cash out to a bank through Paycrest. Banks, rates and the name check work everywhere. */
    bank: {
      async institutions(currency: string): Promise<{ institutions: BankInstitution[] }> {
        return request(`/near/bank/institutions?currency=${encodeURIComponent(currency)}`);
      },
      /** The name on the account. `accountName` is null when the bank does not share it. */
      async verify(input: {
        currency: string;
        institution: string;
        accountIdentifier: string;
      }): Promise<{ institution: string; institutionName: string; accountName: string | null }> {
        return request("/near/bank/verify", json(input));
      },
      async quote(input: { currency: string; amount: string }): Promise<BankQuote> {
        return request("/near/bank/quote", json(input));
      },
      async status(orderId: string, depositAddress: string): Promise<BankStatus> {
        return request(
          `/near/bank/status?orderId=${encodeURIComponent(orderId)}&depositAddress=${encodeURIComponent(depositAddress)}`,
        );
      },
    },

    /** NEAR Intents (1Click): other chains in and out. The API key stays on the server. */
    intents: {
      /** `live` is false on testnet, where every quote is a preview. */
      async assets(): Promise<{ live: boolean; assets: ChainAsset[] }> {
        return request("/near/intents/tokens");
      },
      /** A price. `commit` (money in, mainnet) also returns the address to send to. */
      async quote(input: {
        direction: "in" | "out";
        assetId: string;
        amount: string;
        /** On the other chain: where money out lands, or where failed money in is refunded. */
        address: string;
        commit?: boolean;
      }): Promise<IntentsQuote> {
        return request("/near/intents/quote", json(input));
      },
      async status(depositAddress: string): Promise<IntentsStatus> {
        return request(`/near/intents/status?depositAddress=${encodeURIComponent(depositAddress)}`);
      },
    },
  },
};
