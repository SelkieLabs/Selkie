import type { HandleRef, Keep } from "@selkie/core";
import { Forgetful, handleKey } from "@selkie/core";

/**
 * Which handle owns which Stellar account.
 *
 * This is product state, not chain state: the ledger knows addresses, it does
 * not know that @amaka owns one. The backend owns this table (Postgres in
 * production), so the adapter takes it as an interface and stays storage-free.
 *
 * A handle maps to at most one account, which is what keeps the "one person,
 * one wallet, many linked identities" model true at the chain layer.
 */
export interface AccountRecord {
  handle: HandleRef;
  address: string;
  /** Set once the account exists on the ledger. Until then the wallet is a promise. */
  provisioned: boolean;
}

export interface AccountDirectory {
  lookup(handle: HandleRef): Promise<AccountRecord | null>;
  /** Reverse lookup, used when a claim needs to know who an address belongs to. */
  lookupByAddress(address: string): Promise<AccountRecord | null>;
  save(record: AccountRecord): Promise<void>;
}

const SHELF = "accounts";

export class InMemoryAccountDirectory implements AccountDirectory {
  readonly #byHandle = new Map<string, AccountRecord>();
  readonly #keep: Keep;

  /**
   * Given a Keep, this survives a restart, and it has to.
   *
   * This table is the only thing that connects a handle to the account holding
   * that person's money. Lose it and their balance is still on the ledger and
   * still theirs in every sense except the one that matters: nothing can find
   * it. Worse, the next payment to that handle would provision a second account
   * and succeed, so nothing would look broken from the outside.
   */
  constructor(keep: Keep = new Forgetful()) {
    this.#keep = keep;
    for (const record of keep.read<AccountRecord[]>(SHELF) ?? []) {
      this.#byHandle.set(handleKey(record.handle), record);
    }
  }

  async lookup(handle: HandleRef): Promise<AccountRecord | null> {
    return this.#byHandle.get(handleKey(handle)) ?? null;
  }

  async lookupByAddress(address: string): Promise<AccountRecord | null> {
    for (const record of this.#byHandle.values()) {
      if (record.address === address) return record;
    }
    return null;
  }

  async save(record: AccountRecord): Promise<void> {
    this.#byHandle.set(handleKey(record.handle), record);
    this.#keep.write(SHELF, [...this.#byHandle.values()]);
  }
}
