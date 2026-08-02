import type { HandleRef, Money } from "@selkie/core";
import { handleKey } from "@selkie/core";

/**
 * Asking someone for money.
 *
 * A request is addressed to a HANDLE, not to a user, for the same reason a
 * payment is: the person you are asking may not have joined yet. When they do,
 * the request is waiting for them, which is one more reason to sign in.
 *
 * A request moves no money by itself. It is an invitation to send, and only the
 * person it is addressed to can accept it. That separation is what stops a
 * request from being a way to pull money out of someone's wallet.
 */
export interface MoneyRequest {
  id: string;
  /** Who is asking. */
  fromUserId: string;
  fromHandle: HandleRef;
  /** Who is being asked. A handle, because they may not have an account. */
  toHandle: HandleRef;
  amount: Money;
  note?: string;
  status: RequestStatus;
  createdAt: string;
  settledAt?: string;
  /** Set once paid, so the feed and the request agree on what happened. */
  ref?: string;
}

export type RequestStatus = "pending" | "paid" | "declined" | "cancelled";

export interface NewRequest {
  fromUserId: string;
  fromHandle: HandleRef;
  toHandle: HandleRef;
  amount: Money;
  note?: string;
}

export interface RequestStore {
  create(input: NewRequest): Promise<MoneyRequest>;
  get(id: string): Promise<MoneyRequest | null>;
  settle(id: string, status: RequestStatus, ref?: string): Promise<MoneyRequest>;
  /** Requests this user sent out. */
  sentBy(userId: string): Promise<MoneyRequest[]>;
  /** Requests waiting for any of these handles. */
  addressedTo(handles: HandleRef[]): Promise<MoneyRequest[]>;
}

export class InMemoryRequestStore implements RequestStore {
  readonly #rows = new Map<string, MoneyRequest>();
  #sequence = 0;

  async create(input: NewRequest): Promise<MoneyRequest> {
    const request: MoneyRequest = {
      ...input,
      id: `req_${++this.#sequence}`,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.#rows.set(request.id, request);
    return request;
  }

  async get(id: string): Promise<MoneyRequest | null> {
    return this.#rows.get(id) ?? null;
  }

  async settle(id: string, status: RequestStatus, ref?: string): Promise<MoneyRequest> {
    const existing = this.#rows.get(id);
    if (!existing) throw new Error(`No such request: ${id}`);
    const settled: MoneyRequest = {
      ...existing,
      status,
      settledAt: new Date().toISOString(),
      ref: ref ?? existing.ref,
    };
    this.#rows.set(id, settled);
    return settled;
  }

  async sentBy(userId: string): Promise<MoneyRequest[]> {
    return this.#all().filter((request) => request.fromUserId === userId);
  }

  async addressedTo(handles: HandleRef[]): Promise<MoneyRequest[]> {
    const keys = new Set(handles.map(handleKey));
    return this.#all().filter((request) => keys.has(handleKey(request.toHandle)));
  }

  /** Newest first, so every list reads the same way without sorting again. */
  #all(): MoneyRequest[] {
    return [...this.#rows.values()].reverse();
  }
}
