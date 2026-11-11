import { Asset } from "@stellar/stellar-sdk";

/**
 * The assets Selkie is willing to touch.
 *
 * This is an allowlist on purpose. The escrow contract is token-agnostic, so
 * anyone can lock a worthless token they minted themselves against a handle.
 * Nothing unlisted here is ever shown as a balance or offered in a swap, which
 * is what stops a scam token from appearing in someone's wallet as if Selkie
 * vouched for it.
 */
export interface AssetDef {
  /** Code as users see it, e.g. "USDC". */
  code: string;
  /** Issuer account. Omitted for the native asset (XLM). */
  issuer?: string;
  /** What the app calls it. */
  label: string;
  /** Dollar-denominated assets are the ones we quote balances in. */
  stable: boolean;
}

export const NATIVE_ASSET: AssetDef = {
  code: "XLM",
  label: "Stellar Lumens",
  stable: false,
};

export class UnknownAssetError extends Error {}

export class AssetRegistry {
  readonly #byCode = new Map<string, AssetDef>();

  constructor(assets: AssetDef[]) {
    for (const asset of assets) this.#byCode.set(asset.code.toUpperCase(), asset);
  }

  /** Look up an allowlisted asset, or throw. Callers never construct assets by hand. */
  get(code: string): AssetDef {
    const def = this.#byCode.get(code.trim().toUpperCase());
    if (!def) {
      throw new UnknownAssetError(
        `${code} is not an asset Selkie supports. Supported: ${this.list()
          .map((a) => a.code)
          .join(", ")}`,
      );
    }
    return def;
  }

  has(code: string): boolean {
    return this.#byCode.has(code.trim().toUpperCase());
  }

  list(): AssetDef[] {
    return [...this.#byCode.values()];
  }

  /** The SDK's Asset for a code. The one place codes become chain objects. */
  toStellarAsset(code: string): Asset {
    const def = this.get(code);
    return def.issuer ? new Asset(def.code, def.issuer) : Asset.native();
  }

  /** Reverse lookup, used when reading balances back off the ledger. */
  fromStellarAsset(asset: Asset): AssetDef | undefined {
    if (asset.isNative()) return this.#byCode.get("XLM");
    return this.list().find(
      (def) => def.code === asset.getCode() && def.issuer === asset.getIssuer(),
    );
  }
}
