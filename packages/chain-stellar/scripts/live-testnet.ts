/**
 * Proves the Stellar adapter against the real testnet. No mocks, no stubs.
 *
 *   SPONSOR_SECRET=... ORACLE_SECRET=... npx tsx packages/chain-stellar/scripts/live-testnet.ts
 *
 * It walks the entire product flow:
 *   1. A new user signs up and gets a wallet paid for by Selkie (no XLM, no seed phrase).
 *   2. They are paid some dollars.
 *   3. They send dollars to an X handle that has never touched Selkie, which parks
 *      the money in the escrow contract.
 *   4. That handle "signs in", and the money lands in their brand-new wallet.
 *   5. A second send to the same handle now goes directly, because they exist.
 *   6. They convert some dollars to XLM on Stellar's built-in order book.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Asset, Keypair, Operation } from "@stellar/stellar-sdk";
import { parseHandle } from "@selkie/core";
import {
  InMemoryAccountDirectory,
  InMemorySignerProvider,
  KeypairSigner,
  NATIVE_ASSET,
  StellarAdapter,
  StellarSwapProvider,
  ensureAssetContract,
  testnetConfig,
  type AssetDef,
} from "../src/index";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before running this script.`);
  return value;
}

function deployedEscrowId(): string {
  const file = readFileSync(resolve(REPO_ROOT, "contracts/deployments/testnet.env"), "utf8");
  const match = file.match(/^SELKIE_HANDLE_ESCROW_ID=(\S+)$/m);
  if (!match?.[1]) throw new Error("No escrow contract id in contracts/deployments/testnet.env");
  return match[1];
}

async function fundWithFriendbot(address: string): Promise<void> {
  const response = await fetch(`https://friendbot.stellar.org/?addr=${address}`);
  if (!response.ok && response.status !== 400) {
    throw new Error(`Friendbot refused ${address}: ${response.status}`);
  }
}

const step = (n: number, title: string) => console.log(`\n${"=".repeat(60)}\n${n}. ${title}\n${"=".repeat(60)}`);
const ok = (message: string) => console.log(`   ✅ ${message}`);

async function main() {
  const sponsor = new KeypairSigner(need("SPONSOR_SECRET"));
  const oracle = new KeypairSigner(need("ORACLE_SECRET"));

  // A test issuer standing in for Circle. Same code path as real USDC: the
  // asset's issuer is config, which is exactly why it is config.
  const issuerKeypair = Keypair.random();
  await fundWithFriendbot(issuerKeypair.publicKey());
  const issuer = new KeypairSigner(issuerKeypair.secret());
  const usdc: AssetDef = {
    code: "USDC",
    issuer: issuer.address,
    label: "US Dollar Coin (testnet issuer)",
    stable: true,
  };

  const config = testnetConfig({
    escrowContractId: deployedEscrowId(),
    sponsorAddress: sponsor.address,
    assets: [usdc, NATIVE_ASSET],
    claimLifetimeSeconds: 30 * 24 * 60 * 60,
  });

  const directory = new InMemoryAccountDirectory();
  const signers = new InMemorySignerProvider([sponsor, oracle, issuer]);

  const adapter = new StellarAdapter({
    config,
    directory,
    signers,
    sponsor,
    oracle,
    createSigner: async () => {
      const { signer } = KeypairSigner.generate();
      signers.add(signer);
      return signer;
    },
  });

  console.log(`escrow contract : ${config.escrowContractId}`);
  console.log(`sponsor         : ${sponsor.address}`);
  console.log(`test USDC issuer: ${issuer.address}`);

  // A handle that will use Selkie, and one that has never heard of it.
  const chidi = parseHandle("@chidi", "x");
  const amaka = parseHandle("@amaka_" + Date.now().toString(36), "x");

  // -----------------------------------------------------------------------
  step(0, "Make the dollar asset usable by contracts (one time per network).");
  const sac = await ensureAssetContract({
    network: adapter.network,
    assets: adapter.assets,
    code: "USDC",
    deployer: sponsor,
  });
  ok(`USDC token contract ${sac.contractId} ${sac.deployed ? "deployed now" : "already live"}`);

  // -----------------------------------------------------------------------
  step(1, "A new user signs up. Selkie pays for the wallet.");
  const chidiAccount = await adapter.provision(chidi);
  ok(`@${chidi.username} has a wallet: ${chidiAccount.address}`);
  const afterProvision = await adapter.getBalance(chidiAccount);
  console.log(`   balances: ${JSON.stringify(afterProvision.balances)}`);
  const xlm = afterProvision.balances.find((b) => b.asset === "XLM");
  ok(`holds ${xlm?.amount} XLM, and still has a working account. That is the point.`);

  // -----------------------------------------------------------------------
  step(2, "They receive dollars.");
  await adapter.network.submit({
    source: issuer.address,
    operations: [
      Operation.payment({
        destination: chidiAccount.address,
        asset: new Asset("USDC", issuer.address),
        amount: "100",
      }),
    ],
    signers: [issuer],
  });
  ok(`@${chidi.username} balance: ${(await adapter.balanceOf(chidiAccount, "USDC")).amount} USDC`);

  // -----------------------------------------------------------------------
  step(3, "They pay an X handle that has never used Selkie.");
  console.log(`   paying @${amaka.username}, who has no wallet and no idea Selkie exists`);
  const held = await adapter.send(chidi, amaka, { amount: "25", asset: "USDC" }, "for lunch");
  console.log(`   result: ${JSON.stringify(held)}`);
  if (!held.heldForClaim) throw new Error("Expected the money to be held for a claim");
  ok(`money is waiting in the contract, payment id ${held.claimRef}`);
  ok(`sender now has ${(await adapter.balanceOf(chidiAccount, "USDC")).amount} USDC`);

  const pending = await adapter.pendingClaims(amaka);
  ok(`contract says ${pending.length} payment(s) waiting for @${amaka.username}`);

  // -----------------------------------------------------------------------
  step(4, "That person signs in. The money becomes theirs.");
  const claim = await adapter.claim(amaka);
  ok(`claimed: ${claim.status} (${claim.ref})`);
  const amakaAccount = await adapter.ensureAccount(amaka);
  const amakaBalance = await adapter.balanceOf(amakaAccount, "USDC");
  ok(`@${amaka.username} now holds ${amakaBalance.amount} USDC in ${amakaAccount.address}`);
  if (amakaBalance.amount !== "25") throw new Error(`Expected 25 USDC, got ${amakaBalance.amount}`);

  // -----------------------------------------------------------------------
  step(5, "A second payment to the same handle now settles directly.");
  const direct = await adapter.send(chidi, amaka, { amount: "10", asset: "USDC" });
  console.log(`   result: ${JSON.stringify(direct)}`);
  if (direct.heldForClaim) throw new Error("Expected a direct payment this time");
  ok(`straight to their wallet: ${(await adapter.balanceOf(amakaAccount, "USDC")).amount} USDC`);

  // -----------------------------------------------------------------------
  step(6, "Convert dollars into another Stellar asset.");
  // Someone has to be on the other side of the trade, so stand up a market
  // maker offering XLM for USDC on the built-in order book.
  const makerKeypair = Keypair.random();
  await fundWithFriendbot(makerKeypair.publicKey());
  const maker = new KeypairSigner(makerKeypair.secret());
  signers.add(maker);

  await adapter.network.submit({
    source: maker.address,
    operations: [Operation.changeTrust({ asset: new Asset("USDC", issuer.address) })],
    signers: [maker],
  });
  await adapter.network.submit({
    source: issuer.address,
    operations: [
      Operation.payment({
        destination: maker.address,
        asset: new Asset("USDC", issuer.address),
        amount: "500",
      }),
    ],
    signers: [issuer],
  });
  await adapter.network.submit({
    source: maker.address,
    operations: [
      Operation.manageSellOffer({
        selling: Asset.native(),
        buying: new Asset("USDC", issuer.address),
        amount: "2000",
        price: "0.1", // 0.1 USDC per XLM
      }),
    ],
    signers: [maker],
  });
  ok("a market exists: someone is selling XLM for USDC");

  const swapper = new StellarSwapProvider(adapter.network, adapter.assets, signers, {
    sponsor,
    slippageBps: config.swapSlippageBps,
  });

  const quote = await swapper.quote({ amount: "5", asset: "USDC" }, "XLM");
  ok(`quote: 5 USDC becomes about ${quote.to.amount} XLM`);

  const swapped = await swapper.swap(amakaAccount, { amount: "5", asset: "USDC" }, "XLM");
  ok(`converted (${swapped.ref})`);

  const finalBalance = await adapter.getBalance(amakaAccount);
  console.log(`   final balances: ${JSON.stringify(finalBalance.balances)}`);

  const finalXlm = finalBalance.balances.find((b) => b.asset === "XLM");
  if (!finalXlm || Number(finalXlm.amount) <= 0) throw new Error("Expected XLM after the swap");
  ok(`@${amaka.username} now holds XLM they never had to buy, bought with dollars`);

  console.log(`\n${"=".repeat(60)}\nAll six steps passed against live testnet.\n${"=".repeat(60)}`);
}

main().catch((error) => {
  console.error("\n❌ FAILED:", error?.message ?? error);
  if (error?.response?.data) console.error(JSON.stringify(error.response.data, null, 2));
  process.exitCode = 1;
});
