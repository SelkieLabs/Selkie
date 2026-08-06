import {
  InMemoryAccountDirectory,
  KeypairSigner,
  StellarAdapter,
  StellarDepositReader,
  StellarSwapProvider,
  publicConfig,
  testnetConfig,
} from "@selkie/chain-stellar";
import { InMemoryActivityStore } from "./activity/store";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { BotIdentityProvider } from "./identity/bot";
import { CompositeIdentityProvider } from "./identity/composite";
import { PrivyIdentityProvider } from "./identity/privy";
import { InMemoryUserStore } from "./identity/store";
import { InMemoryIdempotencyStore } from "./idempotency/store";
import { FileKeep } from "./keep";
import { InMemoryRequestStore } from "./requests/store";
import { Wallets } from "./wallets";

/**
 * Wiring. Every choice made here is an interface elsewhere, which is what lets
 * the same app run against testnet in development and mainnet in production
 * without a branch in the payment path.
 */
async function main() {
  const config = loadConfig();

  // Opened before anything else that holds state, because every store below
  // reads from it and a failure here must stop the boot rather than produce a
  // server that has forgotten who its users are.
  const keep = new FileKeep(config.dataFile);

  const sponsor = new KeypairSigner(config.sponsorSecret);
  const oracle = new KeypairSigner(config.oracleSecret);
  const wallets = new Wallets(keep, [sponsor, oracle]);

  const chainConfig = (config.network === "public" ? publicConfig : testnetConfig)({
    escrowContractId: config.escrowContractId,
    sponsorAddress: sponsor.address,
  });

  const adapter = new StellarAdapter({
    config: chainConfig,
    directory: new InMemoryAccountDirectory(keep),
    signers: wallets.signers,
    sponsor,
    oracle,
    createSigner: wallets.create,
  });

  const swap = new StellarSwapProvider(adapter.network, adapter.assets, wallets.signers, {
    sponsor,
    slippageBps: chainConfig.swapSlippageBps,
  });

  // The bot provider exists only where a bot runs. No secret, no path in.
  const privy = new PrivyIdentityProvider(config.privy);
  const provider = config.botSecret
    ? new CompositeIdentityProvider([new BotIdentityProvider(config.botSecret), privy])
    : privy;

  const app = await buildApp({
    users: new InMemoryUserStore(keep),
    provider,
    adapter,
    swap,
    deposits: new StellarDepositReader(adapter.network, adapter.assets),
    activity: new InMemoryActivityStore(keep),
    requests: new InMemoryRequestStore(keep),
    idempotency: new InMemoryIdempotencyStore(keep),
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`Selkie API on :${config.port} (${config.network})`);
  console.log(`escrow ${chainConfig.escrowContractId}`);
  console.log(`sponsor ${sponsor.address}`);
  console.log(`${wallets.count} wallet${wallets.count === 1 ? "" : "s"} loaded from ${config.dataFile}`);
  console.log(config.botSecret ? "bot surface enabled" : "bot surface off (no SELKIE_BOT_SECRET)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
