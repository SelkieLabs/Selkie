import {
  KeypairSigner,
  StellarAdapter,
  StellarDepositReader,
  StellarSwapProvider,
  publicConfig,
  testnetConfig,
} from "@selkie/chain-stellar";
import { PostgresAccountDirectory } from "./accounts/postgres-directory";
import { PostgresActivityStore } from "./activity/postgres-store";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { migrate } from "./db/migrate";
import { openPool } from "./db/pool";
import { Seal } from "./db/seal";
import { BotIdentityProvider } from "./identity/bot";
import { CompositeIdentityProvider } from "./identity/composite";
import { PostgresUserStore } from "./identity/postgres-store";
import { PrivyIdentityProvider } from "./identity/privy";
import { PostgresIdempotencyStore } from "./idempotency/postgres-store";
import { PostgresRequestStore } from "./requests/postgres-store";
import { PostgresSigners } from "./wallets/postgres";

/** How often to drop idempotency keys nobody can still be retrying. */
const SWEEP_EVERY_MS = 60 * 60 * 1000;

/**
 * Wiring. Every choice made here is an interface elsewhere, which is what lets
 * the same app run against testnet in development and mainnet in production
 * without a branch in the payment path.
 */
async function main() {
  const config = loadConfig();

  const pool = openPool(config.databaseUrl);
  // On boot, and before anything is served. A server answering requests against
  // a schema it has not finished applying fails in ways that look like data
  // corruption rather than like a deploy that is halfway done.
  await migrate(pool, (message) => console.log(message));

  const seal = Seal.fromEnv(config.walletKey);
  const sponsor = new KeypairSigner(config.sponsorSecret);
  const oracle = new KeypairSigner(config.oracleSecret);
  // The sponsor and oracle are Selkie's own, from the environment. They are
  // never written to the database: that would only be a second place to leak
  // from, and they exist whether or not a row does.
  const signers = new PostgresSigners(pool, seal, [sponsor, oracle]);

  const chainConfig = (config.network === "public" ? publicConfig : testnetConfig)({
    escrowContractId: config.escrowContractId,
    sponsorAddress: sponsor.address,
  });

  const adapter = new StellarAdapter({
    config: chainConfig,
    directory: new PostgresAccountDirectory(pool),
    signers,
    sponsor,
    oracle,
    createSigner: signers.create,
  });

  const swap = new StellarSwapProvider(adapter.network, adapter.assets, signers, {
    sponsor,
    slippageBps: chainConfig.swapSlippageBps,
  });

  // The bot provider exists only where a bot runs. No secret, no path in.
  const privy = new PrivyIdentityProvider(config.privy);
  const provider = config.botSecret
    ? new CompositeIdentityProvider([new BotIdentityProvider(config.botSecret), privy])
    : privy;

  const idempotency = new PostgresIdempotencyStore(pool);

  const app = await buildApp({
    users: new PostgresUserStore(pool),
    provider,
    adapter,
    swap,
    deposits: new StellarDepositReader(adapter.network, adapter.assets),
    activity: new PostgresActivityStore(pool),
    requests: new PostgresRequestStore(pool),
    idempotency,
  });

  // Housekeeping, not on the request path. Unref'd so it never keeps a shutting
  // down process alive.
  const sweeping = setInterval(() => {
    void idempotency.sweep().catch((error) => app.log.error(error));
  }, SWEEP_EVERY_MS);
  sweeping.unref();

  /**
   * Finish what is in flight, then let go of the database.
   *
   * Without this a deploy kills the process mid-payment: the chain call has
   * already gone out and the row that records it never gets written.
   */
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void (async () => {
        clearInterval(sweeping);
        await app.close().catch(() => {});
        await pool.end().catch(() => {});
        process.exit(0);
      })();
    });
  }

  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`Selkie API on :${config.port} (${config.network})`);
  console.log(`escrow ${chainConfig.escrowContractId}`);
  console.log(`sponsor ${sponsor.address}`);
  console.log(`${await signers.count()} wallets in the database`);
  console.log(config.botSecret ? "bot surface enabled" : "bot surface off (no SELKIE_BOT_SECRET)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
