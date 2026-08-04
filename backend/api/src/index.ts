import {
  InMemorySignerProvider,
  KeypairSigner,
  StellarAdapter,
  StellarSwapProvider,
  publicConfig,
  testnetConfig,
} from "@selkie/chain-stellar";
import { SqliteActivityStore } from "./activity/sqlite-store";
import { buildApp } from "./app";
import { collectFor } from "./claims/collect";
import { SqliteCursorStore, SqliteHandleIndex } from "./claims/index-store";
import { ClaimWatcher } from "./claims/watcher";
import { loadConfig } from "./config";
import { IdentityService } from "./identity/service";
import type { IdentityProviderId } from "./identity/types";
import { isPayable } from "./identity/types";
import { SqliteAccountDirectory } from "./db/directory";
import { openDb } from "./db/open";
import { PrivyIdentityProvider } from "./identity/privy";
import { SqliteUserStore } from "./identity/sqlite-store";
import { SqliteIdempotencyStore } from "./idempotency/sqlite-store";
import { SqliteRequestStore } from "./requests/sqlite-store";

/**
 * Wiring. Every choice made here is an interface elsewhere, which is what lets
 * the same app run against testnet in development and mainnet in production
 * without a branch in the payment path.
 */
async function main() {
  const config = loadConfig();
  const db = openDb(config.dbPath);

  const sponsor = new KeypairSigner(config.sponsorSecret);
  const oracle = new KeypairSigner(config.oracleSecret);
  const signers = new InMemorySignerProvider([sponsor, oracle]);

  const chainConfig = (config.network === "public" ? publicConfig : testnetConfig)({
    escrowContractId: config.escrowContractId,
    sponsorAddress: sponsor.address,
  });

  const adapter = new StellarAdapter({
    config: chainConfig,
    directory: new SqliteAccountDirectory(db),
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

  const users = new SqliteUserStore(db);
  const activity = new SqliteActivityStore(db);
  const handles = new SqliteHandleIndex(db);
  const provider = new PrivyIdentityProvider(config.privy);

  const app = await buildApp({
    users,
    provider,
    adapter,
    swap,
    activity,
    handles,
    requests: new SqliteRequestStore(db),
    idempotency: new SqliteIdempotencyStore(db),
  });

  /**
   * Money can arrive a minute after somebody signs in, while they are sitting
   * on the balance screen. Sign-in alone would leave it invisible until their
   * next login, so one poll of the contract's own events covers everybody.
   */
  const identity = new IdentityService({ users, provider, adapter, handles });
  const watcher = new ClaimWatcher({
    events: { depositsSince: (cursor) => adapter.escrow.depositsSince(cursor) },
    index: handles,
    cursors: new SqliteCursorStore(db),
    ownerOf: async (handle) => {
      // Only handles somebody can actually be paid at have an owner to find.
      const platform = handle.platform as IdentityProviderId;
      return isPayable(platform) ? users.findByHandle(platform, handle.username) : null;
    },
    collect: async (user) => {
      const full = await users.get(user.id);
      if (full) await collectFor({ identity, activity }, full);
    },
    onError: (error) => console.error("[claims]", error),
  });
  watcher.start(config.claimPollSeconds * 1000);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`Selkie API on :${config.port} (${config.network})`);
  console.log(`escrow ${chainConfig.escrowContractId}`);
  console.log(`sponsor ${sponsor.address}`);
  console.log(`database ${config.dbPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
