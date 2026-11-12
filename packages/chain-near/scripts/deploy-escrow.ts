/**
 * Deploy the handle-escrow contract to testnet and initialise it.
 *
 *   npm run near:deploy-escrow
 *
 * 1. Tops the escrow account up to MIN_BALANCE if needed. The contract pays for
 *    its own code (~2.8 NEAR for ~275 KB) and for every payment record, and
 *    refuses new holds when it has less than 0.5 NEAR spare, so it must start
 *    with room. Top-ups come from the testnet faucet via a throwaway account
 *    that is deleted straight into the escrow.
 * 2. Deploys the latest build (contracts-near, plain cargo; see PROGRESS.md).
 * 3. Calls `new` once, signed by the escrow account itself: `new` is #[private],
 *    so nobody can front-run the init and name their own oracle.
 *
 * Testnet only. Re-running redeploys the code and leaves state alone; a state
 * layout change needs a fresh escrow account.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, nearToYocto, type KeyPairString } from "near-api-js";
import { failoverProvider } from "../src/rpc";
import { nearConfigFromEnv } from "../src/config";
import { MIN_HOLD_UNITS } from "../src/escrow";
import { balanceOf, topUpFromFaucet } from "./faucet";

const WASM = resolve(import.meta.dirname, "../../../contracts-near/target/wasm32-unknown-unknown/release/selkie_handle_escrow.wasm");
const MIN_BALANCE = nearToYocto("6");
const MAX_LIFETIME_SECS = 365 * 24 * 60 * 60;

const config = nearConfigFromEnv();
if (config.network !== "testnet") throw new Error("This script only deploys to testnet.");
const escrowKey = process.env.NEAR_ESCROW_KEY as KeyPairString | undefined;
if (!escrowKey) throw new Error("NEAR_ESCROW_KEY missing from .env (run npm run near:setup)");
const owner = process.env.NEAR_ROOT_ACCOUNT;
if (!owner) throw new Error("NEAR_ROOT_ACCOUNT missing from .env");

const provider = failoverProvider(config.rpcUrls ?? [config.rpcUrl]);
const escrow = new Account(config.escrowContract, provider, escrowKey);
const tx = (hash: string) => `${config.explorerUrl}/transactions/${hash}`;

const balance = (accountId: string) => balanceOf(provider, accountId);

async function topUp(): Promise<void> {
  for (const hash of await topUpFromFaucet(provider, escrow.accountId, MIN_BALANCE)) {
    console.log(`topped up ${escrow.accountId} from the faucet: ${tx(hash)}`);
  }
}

/**
 * The smallest payment the escrow will hold in USDC, the same floor prepare
 * checks. Signed by the owner with a full-access key: owner methods want
 * exactly 1 yoctoNEAR, which a function-call key cannot attach.
 */
async function setMinHold() {
  const current = (await provider.callFunction({ contractId: escrow.accountId, method: "get_config", args: {} })) as {
    min_hold?: Record<string, string>;
  };
  const want = MIN_HOLD_UNITS.toString();
  if (current.min_hold?.[config.usdcContract] === want) return;
  const rootKey = process.env.NEAR_ROOT_KEY as KeyPairString | undefined;
  if (!rootKey) throw new Error("NEAR_ROOT_KEY missing from .env: the owner signs set_min_hold");
  const ownerAccount = new Account(owner!, provider, rootKey);
  const set = await ownerAccount.callFunctionRaw({
    contractId: escrow.accountId,
    methodName: "set_min_hold",
    args: { token: config.usdcContract, amount: want },
    deposit: 1n,
    gas: 30_000_000_000_000n,
  });
  console.log(`min hold ${want} for ${config.usdcContract}: ${tx(set.transaction.hash)}`);
}

async function main() {
  await topUp();
  const code = readFileSync(WASM);
  const deployed = await escrow.deployContract(code);
  console.log(`deployed ${code.length} bytes to ${escrow.accountId}: ${tx(deployed.transaction.hash)}`);

  const existing = await provider
    .callFunction({ contractId: escrow.accountId, method: "get_config", args: {} })
    .catch(() => null);
  if (!existing) {
    const init = await escrow.callFunctionRaw({
      contractId: escrow.accountId,
      methodName: "new",
      args: { owner, oracle: config.oracleAccount, tokens: [config.usdcContract], max_lifetime_secs: MAX_LIFETIME_SECS },
      gas: 30_000_000_000_000n,
    });
    console.log(`initialised: ${tx(init.transaction.hash)}`);
  }
  await setMinHold();
  const view = await provider.callFunction({ contractId: escrow.accountId, method: "get_config", args: {} });
  console.log("config", JSON.stringify(view));
  console.log(`balance ${(Number((await balance(escrow.accountId)) / 10n ** 20n) / 10_000).toFixed(4)} NEAR`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
