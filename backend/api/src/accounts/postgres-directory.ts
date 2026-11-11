import type { AccountDirectory, AccountRecord } from "@selkie/chain-stellar";
import type { HandleRef } from "@selkie/core";
import type { Queryable } from "../db/pool";

/**
 * Which handle owns which account on the ledger.
 *
 * This lives in the API rather than in the chain package on purpose: the
 * adapter takes a directory as an interface precisely so that it never has to
 * know what a database is, and putting Postgres in there would undo that.
 *
 * Usernames are folded to lower case on the way in and on the way out, and the
 * database refuses anything else. @Amaka and @amaka are one X account, and a
 * directory that disagreed would hand the same person a second wallet the first
 * time somebody typed their name with a capital letter.
 */
export class PostgresAccountDirectory implements AccountDirectory {
  constructor(private readonly db: Queryable) {}

  async lookup(handle: HandleRef): Promise<AccountRecord | null> {
    const { rows } = await this.db.query<Row>(
      "select platform, username, address, provisioned from accounts where platform = $1 and username = $2",
      [handle.platform, handle.username.toLowerCase()],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  /**
   * Whose account is this?
   *
   * Deliberately not unique in the schema: linking a second handle points it at
   * the wallet somebody already has, which is the entire reason linking exists.
   * The oldest wins, so the answer does not change as handles are added.
   */
  async lookupByAddress(address: string): Promise<AccountRecord | null> {
    const { rows } = await this.db.query<Row>(
      `select platform, username, address, provisioned from accounts
       where address = $1 order by created_at, platform, username limit 1`,
      [address],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async save(record: AccountRecord): Promise<void> {
    await this.db.query(
      `insert into accounts (platform, username, address, provisioned)
       values ($1, $2, $3, $4)
       on conflict (platform, username) do update set
         address     = excluded.address,
         -- Once true it stays true. An account that exists on the ledger cannot
         -- stop existing, and letting a stale write set this back to false would
         -- make Selkie try to create it a second time.
         provisioned = accounts.provisioned or excluded.provisioned`,
      [record.handle.platform, record.handle.username.toLowerCase(), record.address, record.provisioned],
    );
  }
}

interface Row {
  platform: string;
  username: string;
  address: string;
  provisioned: boolean;
}

function toRecord(row: Row): AccountRecord {
  return {
    handle: { platform: row.platform as HandleRef["platform"], username: row.username },
    address: row.address,
    provisioned: row.provisioned,
  };
}
