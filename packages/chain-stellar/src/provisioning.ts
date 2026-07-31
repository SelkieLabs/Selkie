import { Operation } from "@stellar/stellar-sdk";
import type { AssetRegistry } from "./assets";
import type { StellarNetwork } from "./network";
import type { Signer } from "./signer";

/**
 * Creating a wallet that costs the user nothing.
 *
 * A Stellar account normally needs XLM: a base reserve to exist, plus more for
 * every trustline. Asking someone to buy a crypto token before they can receive
 * a dollar is exactly the wall Selkie exists to remove. So the sponsor account
 * pays those reserves using sponsored reserves, and can reclaim them later if
 * the account is ever closed.
 *
 * The result: the user holds a real, self-owned Stellar account with a USDC
 * trustline and zero XLM, and has never heard the word "reserve".
 */
export async function provisionAccount(params: {
  network: StellarNetwork;
  assets: AssetRegistry;
  sponsor: Signer;
  /** Signer for the account being created. It must sign its own trustline ops. */
  account: Signer;
  /** Asset codes to open trustlines for. Native needs none. */
  trustlines: string[];
}): Promise<{ hash: string }> {
  const { network, assets, sponsor, account } = params;

  const operations = [
    Operation.beginSponsoringFutureReserves({ sponsoredId: account.address }),
    Operation.createAccount({ destination: account.address, startingBalance: "0" }),
  ];

  for (const code of params.trustlines) {
    const asset = assets.toStellarAsset(code);
    if (asset.isNative()) continue;
    operations.push(Operation.changeTrust({ asset, source: account.address }));
  }

  operations.push(Operation.endSponsoringFutureReserves({ source: account.address }));

  const response = await network.submit({
    source: sponsor.address,
    operations,
    signers: [sponsor, account],
  });
  return { hash: response.hash };
}

/**
 * Add a trustline to an account that already exists, still paid for by the
 * sponsor. Used when we add support for a new asset after someone signed up.
 */
export async function addSponsoredTrustline(params: {
  network: StellarNetwork;
  assets: AssetRegistry;
  sponsor: Signer;
  account: Signer;
  code: string;
}): Promise<{ hash: string } | null> {
  const asset = params.assets.toStellarAsset(params.code);
  if (asset.isNative()) return null;

  const response = await params.network.submit({
    source: params.sponsor.address,
    operations: [
      Operation.beginSponsoringFutureReserves({ sponsoredId: params.account.address }),
      Operation.changeTrust({ asset, source: params.account.address }),
      Operation.endSponsoringFutureReserves({ source: params.account.address }),
    ],
    signers: [params.sponsor, params.account],
  });
  return { hash: response.hash };
}

/** Does this account already trust the asset, so it can receive it? */
export async function hasTrustline(
  network: StellarNetwork,
  address: string,
  code: string,
  issuer: string | undefined,
): Promise<boolean> {
  if (!issuer) return true; // native needs no trustline
  const account = await network.loadAccount(address);
  return account.balances.some(
    (balance) =>
      "asset_code" in balance &&
      balance.asset_code === code &&
      "asset_issuer" in balance &&
      balance.asset_issuer === issuer,
  );
}
