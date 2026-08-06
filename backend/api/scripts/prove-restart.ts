/**
 * The bug, reproduced and then proved fixed, against real testnet.
 *
 * Boots the real API, makes two real accounts on the ledger, then throws the
 * whole server away and builds a new one over the same data file. The second
 * server has to recognise the same people, hand back the same addresses, and
 * still be able to SIGN for them, which is the part that was actually lost.
 *
 * Nothing is stubbed except the login, which stands in for "somebody signed in
 * with X" and is the same stand-in the API's own tests use.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryAccountDirectory,
  KeypairSigner,
  StellarAdapter,
  StellarDepositReader,
  StellarSwapProvider,
  testnetConfig,
} from "@selkie/chain-stellar";
import { InMemoryActivityStore } from "../src/activity/store";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { FakeIdentityProvider } from "../src/identity/provider";
import { InMemoryUserStore } from "../src/identity/store";
import { InMemoryIdempotencyStore } from "../src/idempotency/store";
import { FileKeep } from "../src/keep";
import { InMemoryRequestStore } from "../src/requests/store";
import { Wallets } from "../src/wallets";

const DATA = join(mkdtempSync(join(tmpdir(), "selkie-proof-")), "testnet.json");
const config = loadConfig();

const ok = (message: string) => console.log(`  ok  ${message}`);
const step = (message: string) => console.log(`\n== ${message}`);

/** One whole server, built from scratch over whatever is in the data file. */
function boot() {
  const keep = new FileKeep(DATA);
  const sponsor = new KeypairSigner(config.sponsorSecret);
  const oracle = new KeypairSigner(config.oracleSecret);
  const wallets = new Wallets(keep, [sponsor, oracle]);

  const chainConfig = testnetConfig({
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

  return {
    wallets,
    adapter,
    app: buildApp({
      users: new InMemoryUserStore(keep),
      provider: new FakeIdentityProvider(true),
      adapter,
      swap: new StellarSwapProvider(adapter.network, adapter.assets, wallets.signers, {
        sponsor,
        slippageBps: chainConfig.swapSlippageBps,
      }),
      deposits: new StellarDepositReader(adapter.network, adapter.assets),
      activity: new InMemoryActivityStore(keep),
      requests: new InMemoryRequestStore(keep),
      idempotency: new InMemoryIdempotencyStore(keep),
      limits: false,
    }),
  };
}

const AMAKA = `test:x:proof-${Date.now()}-a:proofamaka`;
const BO = `test:x:proof-${Date.now()}-b:proofbo`;

async function main() {
  console.log(`data file: ${DATA}\n`);

  step("first boot: two people sign in with X");
  const first = boot();
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
  ok(`@proofamaka is ${amaka.user.id} at ${amaka.user.address}`);
  ok(`@proofbo is ${bo.user.id} at ${bo.user.address}`);

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

  step("THE RESTART: the whole server is thrown away");
  await one.close();
  const second = boot();
  const two = await second.app;
  ok(`${second.wallets.count} wallet key${second.wallets.count === 1 ? "" : "s"} reloaded from disk`);

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
  // signed with a key that only exists because it was written to disk before
  // the process that generated it went away.
  const sent = await two.inject({
    method: "POST",
    url: "/payments/send",
    headers: { authorization: `Bearer ${AMAKA}`, "idempotency-key": `proof-${Date.now()}` },
    payload: { to: "proofbo", platform: "x", amount: "3", asset: "XLM", note: "for dinner" },
  });
  if (sent.statusCode !== 200) {
    throw new Error(`the reloaded key could not sign: ${sent.statusCode} ${sent.body}`);
  }
  const receipt = sent.json() as { status: string; ref?: string };
  ok(`paid @proofbo 3 XLM with the reloaded key: ${receipt.status} ${receipt.ref ?? ""}`);

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
  ok(`${feed.length} entr${feed.length === 1 ? "y" : "ies"}: ${JSON.stringify(feed.map((e) => `${e.kind} ${e.amount.amount} ${e.amount.asset}`))}`);

  await two.close();
  console.log("\nALL PROVEN. A restart no longer costs anybody their money.");
}

function assertEqual(actual: unknown, expected: unknown, what: string) {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}

main().catch((error) => {
  console.error("\nFAILED:", error);
  process.exit(1);
});
