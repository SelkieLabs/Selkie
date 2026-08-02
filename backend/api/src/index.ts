import {
  InMemoryAccountDirectory,
  InMemorySignerProvider,
  KeypairSigner,
  StellarAdapter,
  StellarSwapProvider,
  publicConfig,
  testnetConfig,
} from "@selkie/chain-stellar";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { PrivyIdentityProvider } from "./identity/privy";
import { InMemoryUserStore } from "./identity/store";

/**
 * Wiring. Every choice made here is an interface elsewhere, which is what lets
 * the same app run against testnet in development and mainnet in production
 * without a branch in the payment path.
 */
async function main() {
  const config = loadConfig();

  const sponsor = new KeypairSigner(config.sponsorSecret);
  const oracle = new KeypairSigner(config.oracleSecret);
  const signers = new InMemorySignerProvider([sponsor, oracle]);

  const chainConfig = (config.network === "public" ? publicConfig : testnetConfig)({
    escrowContractId: config.escrowContractId,
    sponsorAddress: sponsor.address,
  });

  const adapter = new StellarAdapter({
    config: chainConfig,
    directory: new InMemoryAccountDirectory(),
    signers,
    sponsor,
    oracle,
    createSigner: async () => {
      const { signer } = KeypairSigner.generate();
      signers.add(signer);
      return signer;
    },
  });

  const swap = new StellarSwapProvider(adapter.network, adapter.assets, signers, {
    sponsor,
    slippageBps: chainConfig.swapSlippageBps,
  });

  const app = buildApp({
    users: new InMemoryUserStore(),
    provider: new PrivyIdentityProvider(config.privy),
    adapter,
    swap,
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`Selkie API on :${config.port} (${config.network})`);
  console.log(`escrow ${chainConfig.escrowContractId}`);
  console.log(`sponsor ${sponsor.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
