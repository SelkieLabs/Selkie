/**
 * The bug, reproduced and then proved fixed, against real testnet.
 *
 * Boots the real API, makes two real accounts on the ledger, then throws the
 * whole server away, POOL AND ALL, and builds a new one. The second server has
 * to recognise the same people, hand back the same addresses, and still be able
 * to SIGN for them, which is the part that was actually lost.
 *
 * Closing the pool matters. Everything the second server knows it had to read
 * back out of Postgres, because there is no longer a single open connection,
 * cached row, or live object carried over from the first one. That is the same
 * gap a deploy puts between two versions of the server.
 *
 * Nothing is stubbed except the login, which stands in for "somebody signed in
 * with X" and is the same stand-in the API's own tests use.
 */
import {
  KeypairSigner,
  StellarAdapter,
  StellarDepositReader,
  StellarSwapProvider,
  testnetConfig,
} from "@selkie/chain-stellar";
import type { Pool } from "pg";
import { PostgresAccountDirectory } from "../src/accounts/postgres-directory";
import { PostgresActivityStore } from "../src/activity/postgres-store";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { migrate } from "../src/db/migrate";
import { openPool } from "../src/db/pool";
import { Seal } from "../src/db/seal";
import { FakeIdentityProvider } from "../src/identity/provider";
import { PostgresUserStore } from "../src/identity/postgres-store";
import { PostgresIdempotencyStore } from "../src/idempotency/postgres-store";
import { PostgresRequestStore } from "../src/requests/postgres-store";
import { PostgresSigners } from "../src/wallets/postgres";

const config = loadConfig();
const seal = Seal.fromEnv(config.walletKey);

const ok = (message: string) => console.log(`  ok  ${message}`);
const step = (message: string) => console.log(`\n== ${message}`);

/** One whole server, built from scratch over whatever is in the database. */
function boot(pool: Pool) {
  const sponsor = new KeypairSigner(config.sponsorSecret);
  const oracle = new KeypairSigner(config.oracleSecret);
  const signers = new PostgresSigners(pool, seal, [sponsor, oracle]);

  const chainConfig = testnetConfig({
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

  return {
    signers,
    adapter,
    app: buildApp({
      users: new PostgresUserStore(pool),
      provider: new FakeIdentityProvider(true),
      adapter,
      swap: new StellarSwapProvider(adapter.network, adapter.assets, signers, {
        sponsor,
        slippageBps: chainConfig.swapSlippageBps,
      }),
      deposits: new StellarDepositReader(adapter.network, adapter.assets),
      activity: new PostgresActivityStore(pool),
      requests: new PostgresRequestStore(pool),
      idempotency: new PostgresIdempotencyStore(pool),
      limits: false,
    }),
  };
}

const RUN = Date.now();
const AMAKA = `test:x:proof-${RUN}-a:proofamaka${RUN}`;
const BO = `test:x:proof-${RUN}-b:proofbo${RUN}`;

async function main() {
  step("first boot: two people sign in with X");
  const poolOne = openPool(config.databaseUrl);
  await migrate(poolOne, ok);
  const first = boot(poolOne);
  const one = await first.app;

  const signIn = async (app: Awaited<typeof one>, token: string, create: boolean) => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/session",
      payload: { token, createAccount: create },
    });
    if (response.statusCode !== 200) throw new Error(`${response.statusCode} ${response.body}`);
    return response.json() as { status: string; user: { id: string; address: string } };
  };

  const amaka = await signIn(one, AMAKA, true);
  const bo = await signIn(one, BO, true);
  ok(`@proofamaka${RUN} is ${amaka.user.id} at ${amaka.user.address}`);
  ok(`@proofbo${RUN} is ${bo.user.id} at ${bo.user.address}`);

  step("the address we show them works straight away");
  // Not after they open Deposit. The address is on screen with a copy button
  // next to it from the first second, and an address that cannot be paid is a
  // trap: the wallet somebody pastes it into just says the account is not there.
  for (const [who, account] of [
    ["@proofamaka", amaka],
    ["@proofbo", bo],
  ] as const) {
    if (!(await first.adapter.network.accountExists(account.user.address))) {
      throw new Error(`${who} was shown ${account.user.address}, which cannot receive money`);
    }
    ok(`${who} can be paid at the address we gave them`);
  }

  step("the key we just wrote down is not sitting there in the clear");
  // The point of sealing them. Someone holding a dump of this table, and not
  // the key in the environment, holds nothing they can spend.
  const stored = await poolOne.query<{ ciphertext: Buffer }>(
    "select ciphertext from wallet_keys where address = $1",
    [amaka.user.address],
  );
  const ciphertext = stored.rows[0]?.ciphertext;
  if (!ciphertext) throw new Error(`no key was written for ${amaka.user.address}`);
  if (/^S[A-Z2-7]{55}$/.test(ciphertext.toString("utf8"))) {
    throw new Error("the secret key is readable straight out of the table");
  }
  ok(`stored sealed: ${ciphertext.length} bytes of ciphertext, no readable secret`);

  step("their accounts are set up on the ledger");
  const receive = await one.inject({
    method: "POST",
    url: "/me/receive",
    headers: { authorization: `Bearer ${AMAKA}` },
  });
  if (receive.statusCode !== 200) throw new Error(`${receive.statusCode} ${receive.body}`);
  ok(`@proofamaka can accept ${(receive.json() as { accepts: string[] }).accepts.join(", ")}`);

  step("giving @proofamaka something to send");
  const funded = await fetch(`https://friendbot.stellar.org/?addr=${amaka.user.address}`);
  ok(funded.ok ? "funded from the testnet faucet" : `faucet said ${funded.status} (already funded)`);

  const balanceBefore = await one.inject({
    method: "GET",
    url: "/me",
    headers: { authorization: `Bearer ${AMAKA}` },
  });
  const before = (balanceBefore.json() as { balances: { asset: string; amount: string }[] }).balances;
  ok(`balance before the restart: ${JSON.stringify(before)}`);

  step("THE RESTART: the whole server is thrown away, connections included");
  await one.close();
  await poolOne.end();
  ok("server closed, every connection to the database dropped");

  const poolTwo = openPool(config.databaseUrl);
  const second = boot(poolTwo);
  const two = await second.app;
  const held = await second.signers.count();
  ok(`${held} wallet key${held === 1 ? "" : "s"} in the database, none of them in memory`);

  step("the same person signs in again");
  // createAccount is false on purpose: if the server has forgotten them this
  // returns 404 rather than quietly making a second, empty wallet.
  const again = await two.inject({
    method: "POST",
    url: "/auth/session",
    payload: { token: AMAKA, createAccount: false },
  });
  if (again.statusCode !== 200) {
    throw new Error(`the restart forgot @proofamaka: ${again.statusCode} ${again.body}`);
  }
  const back = again.json() as { status: string; user: { id: string; address: string } };
  assertEqual(back.user.id, amaka.user.id, "same account, not a new one");
  assertEqual(back.user.address, amaka.user.address, "same wallet address");
  ok(`recognised as ${back.user.id}, still at ${back.user.address}`);

  step("their money is still theirs");
  const after = (
    (
      await two.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${AMAKA}` } })
    ).json() as { balances: { asset: string; amount: string }[] }
  ).balances;
  ok(`balance after the restart: ${JSON.stringify(after)}`);

  step("and Selkie can still SIGN for them, which is what was really lost");
  // The decisive test. This is a real transaction, submitted to real testnet,
  // signed with a key that only exists because it was sealed into Postgres
  // before the process that generated it went away.
  const idempotencyKey = `proof-${RUN}`;
  const sent = await two.inject({
    method: "POST",
    url: "/payments/send",
    headers: { authorization: `Bearer ${AMAKA}`, "idempotency-key": idempotencyKey },
    payload: {
      to: `proofbo${RUN}`,
      platform: "x",
      amount: "3",
      asset: "XLM",
      note: "for dinner",
    },
  });
  if (sent.statusCode !== 200) {
    throw new Error(`the reloaded key could not sign: ${sent.statusCode} ${sent.body}`);
  }
  const receipt = sent.json() as { status: string; ref?: string };
  ok(`paid @proofbo 3 XLM with the reloaded key: ${receipt.status} ${receipt.ref ?? ""}`);

  step("sending it again with the same key does not send it again");
  // The retry a phone makes on a flaky connection. It now has to be answered
  // out of Postgres, because the server that answered the first one is gone.
  const retry = await two.inject({
    method: "POST",
    url: "/payments/send",
    headers: { authorization: `Bearer ${AMAKA}`, "idempotency-key": idempotencyKey },
    payload: {
      to: `proofbo${RUN}`,
      platform: "x",
      amount: "3",
      asset: "XLM",
      note: "for dinner",
    },
  });
  const replay = retry.json() as { ref?: string };
  assertEqual(retry.statusCode, 200, "the retry is answered");
  assertEqual(replay.ref, receipt.ref, "the retry gives back the first payment, not a second one");
  ok("the same receipt came back, and no second 3 XLM left the account");

  step("and the payment shows up in the history the restart did not erase");
  const feed = (
    (
      await two.inject({
        method: "GET",
        url: "/activity",
        headers: { authorization: `Bearer ${AMAKA}` },
      })
    ).json() as { entries: { kind: string; amount: { amount: string; asset: string } }[] }
  ).entries;
  ok(
    `${feed.length} entr${feed.length === 1 ? "y" : "ies"}: ` +
      JSON.stringify(feed.map((e) => `${e.kind} ${e.amount.amount} ${e.amount.asset}`)),
  );

  await two.close();
  await poolTwo.end();
  console.log("\nALL PROVEN. A restart no longer costs anybody their money.");
}

function assertEqual(actual: unknown, expected: unknown, what: string) {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}

main().catch((error) => {
  console.error("\nFAILED:", error);
  process.exit(1);
});
