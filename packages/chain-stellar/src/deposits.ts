import type { HistoryEntry } from "@selkie/core";
import type { AssetRegistry } from "./assets";
import { isNotFound, type StellarNetwork } from "./network";

/**
 * Money that arrived without Selkie's help.
 *
 * Everything else in the feed is product state: Selkie wrote the entry at the
 * moment it did the thing, because the ledger knows one address paid another
 * and does not know you paid @amaka. Deposits are the one case where that is
 * not enough. Someone pastes their address into an exchange, or a faucet, or
 * another wallet, and the money simply appears. No Selkie request happened, so
 * there is nothing for Selkie to have written down, and the feed says "nothing
 * here yet" while the balance says otherwise. That contradiction is the single
 * fastest way to make someone distrust a wallet.
 *
 * So this reads the one thing the ledger is genuinely authoritative about:
 * payments into an address. It is additive, never a replacement. Payments Selkie
 * made are still described by Selkie, and get filtered out here by transaction
 * hash so nothing shows up twice.
 */
export class StellarDepositReader {
  constructor(
    private readonly network: StellarNetwork,
    private readonly assets: AssetRegistry,
  ) {}

  /**
   * Incoming payments to an address, newest first.
   *
   * Unknown assets are dropped rather than shown. An address can be paid in
   * anything at all, including tokens minted to look like real ones, and a feed
   * that renders whatever it is handed is a phishing surface.
   */
  async incoming(address: string, options: { limit?: number } = {}): Promise<HistoryEntry[]> {
    const limit = Math.min(options.limit ?? 50, 200);

    let page;
    try {
      page = await this.network.horizon
        .payments()
        .forAccount(address)
        .order("desc")
        .limit(limit)
        .call();
    } catch (error) {
      // An address nobody has paid yet has no ledger entry at all. That is a
      // new wallet, not a failure, and it has no deposits by definition.
      if (isNotFound(error)) return [];
      throw error;
    }

    const entries: HistoryEntry[] = [];
    for (const record of page.records) {
      const entry = this.#toEntry(record, address);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  #toEntry(record: PaymentRecord, address: string): HistoryEntry | null {
    // create_account is how an address is funded into existence: the starting
    // balance is a real deposit and reads as one, even though it is not a
    // payment operation.
    if (record.type === "create_account") {
      if (record.account !== address) return null;
      const amount = record.starting_balance;
      if (!amount || Number(amount) <= 0) return null;
      return {
        id: `chain_${record.id}`,
        kind: "receive",
        chain: "stellar",
        amount: { amount, asset: "XLM" },
        status: "confirmed",
        at: record.created_at,
        ref: record.transaction_hash,
      };
    }

    if (record.type !== "payment") return null;
    // Outgoing payments are Selkie's own story to tell, and it already told it.
    if (record.to !== address || record.from === address) return null;

    const code = this.#codeOf(record);
    if (!code || !record.amount) return null;

    return {
      id: `chain_${record.id}`,
      kind: "receive",
      chain: "stellar",
      amount: { amount: record.amount, asset: code },
      status: "confirmed",
      at: record.created_at,
      ref: record.transaction_hash,
    };
  }

  /** The asset's Selkie code, or null when it is not one we recognise. */
  #codeOf(record: PaymentRecord): string | null {
    if (record.asset_type === "native") return "XLM";
    if (!record.asset_code || !record.asset_issuer) return null;

    const def = this.assets.list().find(
      (asset) => asset.code === record.asset_code && asset.issuer === record.asset_issuer,
    );
    // Same code, different issuer, is a different asset and usually a fake.
    return def ? def.code : null;
  }
}

/** Only the fields we read. Horizon's own payment union is wider than this. */
interface PaymentRecord {
  id: string;
  type: string;
  created_at: string;
  transaction_hash: string;
  amount?: string;
  starting_balance?: string;
  account?: string;
  from?: string;
  to?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}
