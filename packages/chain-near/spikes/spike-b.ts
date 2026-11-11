/**
 * Spike B: the escrow skeleton deploys and receives a NEP-141 transfer.
 *
 * 1. deploy contracts-near handle-escrow to escrow.<root> and initialise it
 *    (owner = root, oracle = oracle.<root>, tokens = [testnet USDC])
 * 2. root sends 1 USDC with ft_transfer_call and a `hold` msg
 * 3. print the receipts' logs (the parsed msg comes back as a NEP-297 event)
 *    and the escrow's USDC balance
 *
 * Throwaway, not product code. Needs USDC in the root account first
 * (faucet.circle.com -> NEAR Testnet -> the root account id).
 *
 *   npx tsx --env-file=.env packages/chain-near/spikes/spike-b.ts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, JsonRpcProvider } from "near-api-js";

const WASM = resolve(import.meta.dirname, "../../../contracts-near/target/wasm32-unknown-unknown/release/selkie_handle_escrow.wasm");
const EXPLORER = "https://explorer.testnet.near.org";
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} missing from .env`);
  return v;
};
type Key = `ed25519:${string}`;

const provider = new JsonRpcProvider({ url: env("NEAR_RPC_URL") });
const usdc = env("NEAR_USDC_CONTRACT");
const escrowId = env("NEAR_ESCROW_CONTRACT");
const root = new Account(env("NEAR_ROOT_ACCOUNT"), provider, env("NEAR_ROOT_KEY") as Key);
const escrow = new Account(escrowId, provider, env("NEAR_ESCROW_KEY") as Key);

async function main() {
  // 1. Deploy (always: the spike redeploys the latest build) and init once.
  const code = readFileSync(WASM);
  const deployed = await escrow.deployContract(code);
  console.log(`deployed ${code.length} bytes to ${escrowId}: ${EXPLORER}/transactions/${deployed.transaction.hash}`);
  const config = await provider
    .callFunction({ contractId: escrowId, method: "get_config", args: {} })
    .catch(() => null);
  if (!config) {
    const init = await escrow.callFunctionRaw({
      contractId: escrowId,
      methodName: "new",
      args: { owner: root.accountId, oracle: env("NEAR_ORACLE_ACCOUNT"), tokens: [usdc] },
      gas: 30_000_000_000_000n,
    });
    console.log(`initialised: ${EXPLORER}/transactions/${init.transaction.hash}`);
  }
  console.log("config", JSON.stringify(await provider.callFunction({ contractId: escrowId, method: "get_config", args: {} })));

  // 2. 1 USDC (6 decimals) with a hold msg for sha256("x:selkie_spike").
  const balance = await provider.callFunction<string>({ contractId: usdc, method: "ft_balance_of", args: { account_id: root.accountId } });
  console.log(`root USDC balance: ${balance}`);
  if (BigInt(balance ?? "0") < 1_000_000n) {
    console.log(`\nNeed 1 USDC in ${root.accountId}: faucet.circle.com -> NEAR Testnet -> ${root.accountId}`);
    return;
  }
  const recipient = createHash("sha256").update("x:selkie_spike").digest("hex");
  const msg = JSON.stringify({ kind: "hold", recipient, lifetime_secs: 2_592_000 });
  const before = await provider.callFunction<string>({ contractId: usdc, method: "ft_balance_of", args: { account_id: escrowId } });
  const tx = await root.callFunctionRaw({
    contractId: usdc,
    methodName: "ft_transfer_call",
    args: { receiver_id: escrowId, amount: "1000000", msg },
    deposit: 1n, // NEP-141 requires exactly 1 yoctoNEAR on transfers, as proof of a full-access signer
    gas: 100_000_000_000_000n,
  });
  console.log(`\nft_transfer_call: ${EXPLORER}/transactions/${tx.transaction.hash}`);
  for (const r of tx.receipts_outcome) {
    for (const log of r.outcome.logs) console.log(`  [${r.outcome.executor_id.slice(0, 20)}] ${log}`);
  }
  const after = await provider.callFunction<string>({ contractId: usdc, method: "ft_balance_of", args: { account_id: escrowId } });
  console.log(`escrow USDC balance: ${before} -> ${after}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
