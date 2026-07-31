import { Operation, rpc, xdr } from "@stellar/stellar-sdk";
import type { AssetRegistry } from "./assets";
import type { StellarNetwork } from "./network";
import type { Signer } from "./signer";

/**
 * One-time setup an asset needs before Selkie can escrow it.
 *
 * Every classic Stellar asset has a deterministic contract address, but the
 * contract instance at that address has to be deployed once before any Soroban
 * contract can move the asset. Until then a token transfer fails with
 * "non-existing value for contract instance", which reads like a bug in your
 * code and is actually a missing deployment.
 *
 * This is bootstrap, not a payment-time concern: it runs when Selkie starts
 * supporting an asset on a network, and never again. USDC's contract is already
 * deployed on mainnet, so in production this is a no-op that costs one query.
 */
export async function ensureAssetContract(params: {
  network: StellarNetwork;
  assets: AssetRegistry;
  code: string;
  /** Pays for the deployment. Any funded account can do it, once. */
  deployer: Signer;
}): Promise<{ contractId: string; deployed: boolean }> {
  const asset = params.assets.toStellarAsset(params.code);
  const contractId = asset.contractId(params.network.networkPassphrase);

  if (await assetContractExists(params.network, contractId)) {
    return { contractId, deployed: false };
  }

  await params.network.invokeContract({
    source: params.deployer.address,
    signer: params.deployer,
    operation: Operation.createStellarAssetContract({ asset }),
  });

  return { contractId, deployed: true };
}

/** Is the token contract live on this network yet? */
export async function assetContractExists(
  network: StellarNetwork,
  contractId: string,
): Promise<boolean> {
  try {
    const entry = await network.rpc.getContractData(
      contractId,
      xdr.ScVal.scvLedgerKeyContractInstance(),
      rpc.Durability.Persistent,
    );
    return Boolean(entry);
  } catch {
    // The RPC throws rather than returning empty when the instance is absent.
    return false;
  }
}
