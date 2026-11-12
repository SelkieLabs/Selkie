import { NearChain, OneClickClient, nearConfigFromEnv } from "@selkie/chain-near";
import { PostgresActivityStore } from "../activity/postgres-store";
import { migrate } from "../db/migrate";
import { openPool } from "../db/pool";
import { PostgresUserStore } from "../identity/postgres-store";
import { createHmac } from "node:crypto";
import { PostgresEmailStore } from "../email/postgres-store";
import { EmailService, logSender, resendSender } from "../email/service";
import { PrivyIdentityProvider } from "../identity/privy";
import { PushNotifier, webPushSender } from "../push/notifier";
import { PostgresPushStore } from "../push/postgres-store";
import { PostgresRequestStore } from "../requests/postgres-store";
import { buildNearApp } from "./app";
import { PaycrestClient } from "./paycrest";
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

  // Push is optional: without keys the wallet still says so in an open tab.
  const vapid = {
    publicKey: env.WEB_PUSH_PUBLIC_KEY ?? "",
    privateKey: env.WEB_PUSH_PRIVATE_KEY ?? "",
    subject: env.WEB_PUSH_SUBJECT || env.SELKIE_WEB_URL || "",
  };
  const pushStore = new PostgresPushStore(pool);
  const push =
    vapid.publicKey && vapid.privateKey && vapid.subject
      ? {
          store: pushStore,
          publicKey: vapid.publicKey,
          notifier: new PushNotifier({
            store: pushStore,
            send: webPushSender(vapid),
            // Status and message only: a push error also carries the browser's endpoint.
            onError: (error) =>
              console.warn("[push]", (error as { statusCode?: number }).statusCode ?? "", error instanceof Error ? error.message : error),
          }),
        }
      : undefined;

  // Email is optional too. Resend in production; locally, EMAIL_DEV_LOG=1
  // prints each email to this console so the code can be read without a provider.
  const sendEmail =
    env.RESEND_API_KEY && env.EMAIL_FROM
      ? resendSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })
      : env.EMAIL_DEV_LOG === "1"
        ? logSender
        : null;
  const email = sendEmail
    ? new EmailService({
        store: new PostgresEmailStore(pool),
        send: sendEmail,
        webUrl: (env.EMAIL_LINK_BASE_URL || env.SELKIE_WEB_URL || "http://localhost:3000").replace(/\/$/, ""),
        // Its own secret if given; otherwise one derived from the Privy secret,
        // which every NEAR deploy already has and which this cannot reveal.
        linkSecret:
          env.EMAIL_LINK_SECRET || createHmac("sha256", privy.appSecret).update("selkie email unsubscribe links").digest("hex"),
        onError: (error) => console.warn("[email]", error instanceof Error ? error.message : error),
      })
    : undefined;

  const app = await buildNearApp({
    users: new PostgresUserStore(pool),
    // The user's key is their Privy embedded NEAR wallet; nothing else is.
    provider: new PrivyIdentityProvider({ ...privy, walletChainType: "near" }),
    chain,
    accounts: new PostgresNearAccountStore(pool),
    prepares: new PostgresPrepareStore(pool),
    activity: new PostgresActivityStore(pool),
    requests: new PostgresRequestStore(pool),
    xLookup: env.X_BEARER_TOKEN ? new XApiUserLookup(env.X_BEARER_TOKEN) : noXLookup,
    push,
    email,
    // 1Click is public; a JWT from partners.near-intents.org only lowers its fee.
    intents: new OneClickClient({
      baseUrl: env.ONECLICK_API_URL || "https://1click.chaindefuser.com",
      jwt: env.ONECLICK_JWT || undefined,
    }),
    // Banks, rates and name checks are public; orders need the key and a
    // refund address. Secrets stay in this process.
    paycrest: new PaycrestClient({
      baseUrl: env.PAYCREST_API_URL || "https://api.paycrest.io",
      apiKey: env.PAYCREST_API_KEY || undefined,
      apiSecret: env.PAYCREST_API_SECRET || undefined,
      network: env.PAYCREST_NETWORK || "base",
      refundAddress: env.PAYCREST_REFUND_ADDRESS || undefined,
    }),
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
  console.log(
    config.network === "mainnet"
      ? "NEAR Intents on (1Click)"
      : "NEAR Intents: previews only (1Click is mainnet; testnet shows live quotes, moves nothing)",
  );
  console.log(
    config.network !== "mainnet"
      ? "bank cash-out: preview only on testnet (banks, rates, name check)"
      : env.PAYCREST_API_KEY && env.PAYCREST_REFUND_ADDRESS
        ? `bank cash-out on (Paycrest, USDC on ${env.PAYCREST_NETWORK || "base"})`
        : "bank cash-out: preview only (set PAYCREST_API_KEY and PAYCREST_REFUND_ADDRESS)",
  );
  console.log(push ? "push notifications on" : "push notifications off (npm run push:keys, then restart)");
  console.log(
    !email
      ? "email notices off (set RESEND_API_KEY and EMAIL_FROM, or EMAIL_DEV_LOG=1)"
      : env.RESEND_API_KEY
        ? "email notices on (Resend)"
        : "email notices on, printed here instead of sent (EMAIL_DEV_LOG=1)",
  );
}
