import { randomUUID } from "node:crypto";
import type { HandleRef, Money } from "@selkie/core";
import type { PreparedDelegate, RecipientScheme } from "@selkie/chain-near";

/** An X user's NEAR account. */
export interface NearAccountRecord {
  xUserId: string;
  accountId: string;
  publicKey: string;
  createdAt: string;
}

export interface NearAccountStore {
  findByXUserId(xUserId: string): Promise<NearAccountRecord | null>;
  findByAccountId(accountId: string): Promise<NearAccountRecord | null>;
  /**
   * Throws if either the X user or the account id is already recorded. A new
   * account starts with an expected USDC balance of zero.
   */
  insert(record: Omit<NearAccountRecord, "createdAt">): Promise<NearAccountRecord>;
  /** The USDC balance Selkie expects, in base units; null if it never counted (see BalanceWatch). */
  seenUsdc(accountId: string): Promise<bigint | null>;
  /** Start counting at `units`, unless counting already started. */
  startSeenUsdc(accountId: string, units: bigint): Promise<void>;
  /** Move the expected balance by `delta`. No-op for an account Selkie is not counting. */
  addSeenUsdc(accountId: string, delta: bigint): Promise<void>;
}

/** One person in a "pay many": paid straight into their account, or held for their key. */
export interface ManyItem {
  to: HandleRef;
  recipientUserId?: string;
  /** Their NEAR account, when they are paid straight into it. */
  recipientAccount?: string;
  recipientKey?: string;
}

/**
 * What a prepared action means to Selkie, so the feed can describe it once it
 * lands. `requestId` is set when the payment answers a request.
 */
export type PaymentIntent =
  | { kind: "send"; to: HandleRef; amount: Money; recipientAccount: string; recipientUserId: string; requestId?: string }
  | { kind: "hold"; to: HandleRef; amount: Money; recipientKey: string; scheme: RecipientScheme; requestId?: string }
  | {
      kind: "transfer";
      toAccount: string;
      amount: Money;
      purpose: "send" | "cashout";
      recipientUserId?: string;
      /** Set when the transfer is a NEAR Intents deposit: money leaving for another chain. */
      intents?: IntentsCashOut;
      /** Set when that deposit pays a Paycrest order: money leaving for a bank account. */
      bank?: BankCashOut;
    }
  | { kind: "many"; amount: Money; items: ManyItem[] }
  | { kind: "refund"; claimRef: string; amount: Money }
  | PocketIntent;

/**
 * The owner's own changes to their X pocket, signed by their key. `amount` is
 * what moves (zero for a new daily limit); `dailyCap` is set when the limit changes.
 */
export interface PocketIntent {
  kind: "pocket";
  action: "top_up" | "withdraw" | "set_cap";
  amount: Money;
  dailyCap?: Money;
}

/** A cash-out to another chain, as the quote that priced it described it. */
export interface IntentsCashOut {
  depositAddress: string;
  chainName: string;
  symbol: string;
  /** Where it lands on the other chain. */
  address: string;
  amountOutFormatted: string;
}

/** A cash-out to a bank account: a Paycrest order, paid through NEAR Intents. */
export interface BankCashOut {
  orderId: string;
  depositAddress: string;
  currency: string;
  institutionName: string;
  /** Only the last four digits are kept. */
  accountLast4: string;
  accountName: string;
  /** USDC the Paycrest order is for (what leaves is `amount`, a little more). */
  orderAmount: string;
  rate: string;
  /** About what arrives, in `currency`. */
  fiatAmount: string;
}

export interface PrepareRecord {
  id: string;
  userId: string;
  delegate: PreparedDelegate;
  intent: PaymentIntent;
  expiresAt: string;
}

export interface PrepareStore {
  create(input: Omit<PrepareRecord, "id">): Promise<PrepareRecord>;
  /**
   * Mark a prepare used and return it, or null if it is not this user's, has
   * expired, or was already used. One atomic step, so two relays of the same
   * signature cannot both get through.
   */
  take(id: string, userId: string): Promise<PrepareRecord | null>;
}

export class InMemoryNearAccountStore implements NearAccountStore {
  readonly #rows = new Map<string, NearAccountRecord>();
  readonly #seen = new Map<string, bigint>();

  async findByXUserId(xUserId: string) {
    return this.#rows.get(xUserId) ?? null;
  }

  async findByAccountId(accountId: string) {
    return [...this.#rows.values()].find((row) => row.accountId === accountId) ?? null;
  }

  async insert(record: Omit<NearAccountRecord, "createdAt">) {
    if (this.#rows.has(record.xUserId) || (await this.findByAccountId(record.accountId))) {
      throw new Error("NEAR account already recorded");
    }
    const saved = { ...record, createdAt: new Date().toISOString() };
    this.#rows.set(record.xUserId, saved);
    this.#seen.set(record.accountId, 0n);
    return saved;
  }

  async seenUsdc(accountId: string) {
    return this.#seen.get(accountId) ?? null;
  }

  async startSeenUsdc(accountId: string, units: bigint) {
    if (!this.#seen.has(accountId) && (await this.findByAccountId(accountId))) this.#seen.set(accountId, units);
  }

  async addSeenUsdc(accountId: string, delta: bigint) {
    const seen = this.#seen.get(accountId);
    if (seen !== undefined) this.#seen.set(accountId, seen + delta);
  }

  /** Tests: an account opened before Selkie kept count. */
  forgetSeenUsdc(accountId: string) {
    this.#seen.delete(accountId);
  }
}

export class InMemoryPrepareStore implements PrepareStore {
  readonly #rows = new Map<string, PrepareRecord & { used: boolean }>();

  async create(input: Omit<PrepareRecord, "id">) {
    const record = { ...structuredClone(input), id: randomUUID() };
    this.#rows.set(record.id, { ...record, used: false });
    return structuredClone(record);
  }

  async take(id: string, userId: string) {
    const row = this.#rows.get(id);
    if (!row || row.used || row.userId !== userId || Date.parse(row.expiresAt) < Date.now()) return null;
    row.used = true;
    const { used: _used, ...record } = row;
    return structuredClone(record);
  }
}
