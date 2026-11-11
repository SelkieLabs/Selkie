import { NearChain, nearConfigFromEnv } from "@selkie/chain-near";
import { PostgresActivityStore } from "../activity/postgres-store";
import { migrate } from "../db/migrate";
import { openPool } from "../db/pool";
import { PostgresUserStore } from "../identity/postgres-store";
import { PrivyIdentityProvider } from "../identity/privy";
import { buildNearApp } from "./app";
import { PostgresNearAccountStore, PostgresPrepareStore } from "./postgres-store";
import { XApiUserLookup, noXLookup } from "./x-lookup";

/**
 * Wiring for NEAR mode (SELKIE_CHAIN=near).
 *
 * Its own database (NEAR_DATABASE_URL), never the Stellar one: the two products
 * have different users, addresses and feeds, and one table holding both would
 * eventually show somebody a balance from the wrong chain.
 */
export async function mainNear(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const databaseUrl = env.NEAR_DATABASE_URL;
  if (!databaseUrl) throw new Error("NEAR_DATABASE_URL is not set. NEAR mode never shares the Stellar database.");
  const privy = { appId: env.PRIVY_APP_ID ?? "", appSecret: env.PRIVY_APP_SECRET ?? "" };
  if (!privy.appId || !privy.appSecret) throw new Error("PRIVY_APP_ID and PRIVY_APP_SECRET are required.");

  const config = nearConfigFromEnv(env);
  const chain = new NearChain(config);

  const pool = openPool(databaseUrl);
  await migrate(pool, (message) => console.log(message));

  const app = await buildNearApp({
    users: new PostgresUserStore(pool),
    // The user's key is their Privy embedded NEAR wallet; nothing else is.
    provider: new PrivyIdentityProvider({ ...privy, walletChainType: "near" }),
    chain,
    accounts: new PostgresNearAccountStore(pool),
    prepares: new PostgresPrepareStore(pool),
    activity: new PostgresActivityStore(pool),
    xLookup: env.X_BEARER_TOKEN ? new XApiUserLookup(env.X_BEARER_TOKEN) : noXLookup,
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void (async () => {
        await app.close().catch(() => {});
        await pool.end().catch(() => {});
        process.exit(0);
      })();
    });
  }

  const port = Number(env.PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Selkie API on :${port} (NEAR ${config.network})`);
  console.log(`escrow ${config.escrowContract}, USDC ${config.usdcContract}`);
  console.log(`accounts under ${config.handleParent}; relayer ${config.relayerAccount}; oracle ${config.oracleAccount}`);
  console.log(env.X_BEARER_TOKEN ? "X user-id recipient keys on" : "X user-id lookup off (username keys only)");
}
