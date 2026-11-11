import type { HandleRef } from "@selkie/core";
import { handleKey } from "@selkie/core";

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

export class InMemoryAccountDirectory implements AccountDirectory {
  readonly #byHandle = new Map<string, AccountRecord>();

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
  }
}
