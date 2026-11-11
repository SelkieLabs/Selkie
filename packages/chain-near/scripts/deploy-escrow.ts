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
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, type KeyPairString } from "near-api-js";
import { nearConfigFromEnv } from "../src/config";

const WASM = resolve(import.meta.dirname, "../../../contracts-near/target/wasm32-unknown-unknown/release/selkie_handle_escrow.wasm");
const FAUCET_URL = "https://helper.nearprotocol.com/account";
const MIN_BALANCE = nearToYocto("6");
const MAX_LIFETIME_SECS = 365 * 24 * 60 * 60;

const config = nearConfigFromEnv();
if (config.network !== "testnet") throw new Error("This script only deploys to testnet.");
const escrowKey = process.env.NEAR_ESCROW_KEY as KeyPairString | undefined;
if (!escrowKey) throw new Error("NEAR_ESCROW_KEY missing from .env (run npm run near:setup)");
const owner = process.env.NEAR_ROOT_ACCOUNT;
if (!owner) throw new Error("NEAR_ROOT_ACCOUNT missing from .env");

const provider = new JsonRpcProvider({ url: config.rpcUrl });
const escrow = new Account(config.escrowContract, provider, escrowKey);
const tx = (hash: string) => `${config.explorerUrl}/transactions/${hash}`;

async function balance(accountId: string): Promise<bigint> {
  const view = await provider.viewAccount({ accountId });
  return BigInt(view.amount);
}

/** Faucet -> throwaway account -> DeleteAccount with the escrow as beneficiary. */
async function topUp(): Promise<void> {
  while ((await balance(escrow.accountId)) < MIN_BALANCE) {
    const key = KeyPair.fromRandom("ed25519");
    const temp = `selkie-topup-${Date.now().toString(36)}.testnet`;
    const res = await fetch(FAUCET_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newAccountId: temp, newAccountPublicKey: key.getPublicKey().toString() }),
    });
    if (!res.ok) throw new Error(`Faucet refused ${temp}: ${res.status} ${await res.text()}`);
    for (let i = 0; i < 20; i++) {
      try {
        await balance(temp);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    const funder = new Account(temp, provider, key.toString() as KeyPairString);
    const result = await funder.signAndSendTransaction({
      receiverId: temp,
      actions: [actions.deleteAccount(escrow.accountId)],
    });
    console.log(`topped up ${escrow.accountId} from the faucet: ${tx(result.transaction.hash)}`);
  }
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
  const view = await provider.callFunction({ contractId: escrow.accountId, method: "get_config", args: {} });
  console.log("config", JSON.stringify(view));
  console.log(`balance ${(Number((await balance(escrow.accountId)) / 10n ** 20n) / 10_000).toFixed(4)} NEAR`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
