import type { HandleRef } from "@selkie/core";
import type { AccountDirectory, AccountRecord } from "@selkie/chain-stellar";
import { fromBool, toBool, type Db } from "./open";

interface Row {
  platform: string;
  username: string;
  address: string;
  provisioned: number;
}

/**
 * Which handle owns which Stellar address, on disk.
 *
 * It lives in the backend rather than in `@selkie/chain-stellar` on purpose: the
 * adapter takes this as an interface and stays storage-free, because the ledger
 * knows addresses and only the product knows that @amaka owns one.
 *
 * Losing this table is worse than it sounds. The address is where a handle's
 * money already is, so a handle that came back mapped to a different address
 * would be a person whose balance vanished.
 */
export class SqliteAccountDirectory implements AccountDirectory {
  constructor(private readonly db: Db) {}

  async lookup(handle: HandleRef): Promise<AccountRecord | null> {
    const row = this.db
      .prepare("SELECT * FROM accounts WHERE platform = ? AND username = ?")
      .get(handle.platform, handle.username) as Row | undefined;
    return row ? hydrate(row) : null;
  }

  async lookupByAddress(address: string): Promise<AccountRecord | null> {
    const row = this.db.prepare("SELECT * FROM accounts WHERE address = ?").get(address) as
      | Row
      | undefined;
    return row ? hydrate(row) : null;
  }

  async save(record: AccountRecord): Promise<void> {
    // The address never changes once a handle has one; only `provisioned` moves,
    // from false to true. Overwriting an address would strand whatever is
    // already sitting at the old one.
    this.db
      .prepare(
        `INSERT INTO accounts (platform, username, address, provisioned)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (platform, username) DO UPDATE SET
           provisioned = excluded.provisioned`,
      )
      .run(
        record.handle.platform,
        record.handle.username,
        record.address,
        fromBool(record.provisioned),
      );
  }
}

function hydrate(row: Row): AccountRecord {
  return {
    handle: { platform: row.platform as HandleRef["platform"], username: row.username },
    address: row.address,
    provisioned: toBool(row.provisioned),
  };
}
