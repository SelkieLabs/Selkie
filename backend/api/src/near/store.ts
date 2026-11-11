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
  /** Throws if either the X user or the account id is already recorded. */
  insert(record: Omit<NearAccountRecord, "createdAt">): Promise<NearAccountRecord>;
}

/** One person in a "pay many": paid straight into their account, or held for their key. */
export interface ManyItem {
  to: HandleRef;
  recipientUserId?: string;
  recipientKey?: string;
}

/**
 * What a prepared action means to Selkie, so the feed can describe it once it
 * lands. `requestId` is set when the payment answers a request.
 */
export type PaymentIntent =
  | { kind: "send"; to: HandleRef; amount: Money; recipientAccount: string; recipientUserId: string; requestId?: string }
  | { kind: "hold"; to: HandleRef; amount: Money; recipientKey: string; scheme: RecipientScheme; requestId?: string }
  | { kind: "transfer"; toAccount: string; amount: Money; purpose: "send" | "cashout"; recipientUserId?: string }
  | { kind: "many"; amount: Money; items: ManyItem[] }
  | { kind: "refund"; claimRef: string; amount: Money };

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
    return saved;
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
