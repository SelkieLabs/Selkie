/**
 * Mainnet setup for Selkie on NEAR. Prints a plan by default and changes nothing:
 *
 *   npm run near:setup:mainnet              # plan: what it would create and what it costs
 *   SELKIE_MAINNET_OK=yes npm run near:setup:mainnet -- --execute
 *
 * Mainnet accounts cost real NEAR, so this script never runs on its own say-so.
 * `--execute` also needs SELKIE_MAINNET_OK=yes, set by the human who agreed to
 * spend it. Everything lives in `.env.mainnet` (gitignored), apart from the
 * testnet `.env`, so a mainnet key can never end up in the testnet API.
 *
 * The root, selkiepay.near, is not created here. The human creates it in their
 * own wallet and adds the public key this script prints as a full-access key,
 * so the root's private key is generated on this machine and never travels.
 * After that, `--execute` creates the same children as testnet:
 *
 *   x.selkiepay.near        creates handle accounts (0.01 NEAR each)
 *   escrow.selkiepay.near   the handle-escrow contract (~2.92 NEAR of code storage)
 *   relayer.selkiepay.near  pays gas and each user's USDC storage (0.00125 NEAR)
 *   oracle.selkiepay.near   a function-call key on escrow.claim, nothing else
 *
 * USDC's contract is read from 1Click's token list, never typed in.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, KeyPair, actions, nearToYocto, type KeyPairString } from "near-api-js";
import { failoverProvider, rpcUrls } from "../src/rpc";
import { listAccessKeys } from "../src/keys";

const ENV_PATH = resolve(import.meta.dirname, "../../../.env.mainnet");
const RPC = process.env.NEAR_RPC_URL || "https://free.rpc.fastnear.com,https://rpc.mainnet.fastnear.com";
// Verified 12 Nov 2026: explorer.near.org serves mainnet accounts (nearblocks.io answers 403 to scripts).
const EXPLORER = process.env.NEAR_EXPLORER_URL || "https://explorer.near.org";
const ONECLICK = process.env.ONECLICK_API_URL || "https://1click.chaindefuser.com";
const root = process.env.NEAR_ROOT_ACCOUNT || "selkiepay.near";
const execute = process.argv.includes("--execute");
const provider = failoverProvider(rpcUrls(RPC));

if (!root.endsWith(".near")) throw new Error(`NEAR_ROOT_ACCOUNT must be a .near account, got ${root}`);
if (execute && process.env.SELKIE_MAINNET_OK !== "yes") {
  throw new Error("--execute spends real NEAR. Set SELKIE_MAINNET_OK=yes once the human has agreed.");
}

// What each account needs to do its job, with headroom. The escrow refuses new
// holds below 0.5 NEAR spare, so it starts with room above its ~2.9 NEAR of code.
const CHILDREN = [
  { prefix: "x", env: "NEAR_HANDLE_PARENT", near: "1", why: "about 90 sign-ups at 0.01 NEAR each, plus gas" },
  { prefix: "escrow", env: "NEAR_ESCROW_CONTRACT", near: "4", why: "~2.92 NEAR of code storage, 0.5 spare, payment records" },
  { prefix: "relayer", env: "NEAR_RELAYER_ACCOUNT", near: "1", why: "gas for users' signed actions, USDC storage per user" },
  { prefix: "oracle", env: "NEAR_ORACLE_ACCOUNT", near: "0.3", why: "gas for claims", oracle: true },
] as const;
/** Kept on the root for its own storage and the escrow owner calls. */
const ROOT_RESERVE = "0.2";

function readEnvFile(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2]) out[m[1]!] = m[2];
  }
  return out;
}

/** Reuse a key already in .env.mainnet, or (when executing) make one and append it. */
function key(envName: string): KeyPairString | null {
  const existing = process.env[envName] || readEnvFile()[envName];
  if (existing) return existing as KeyPairString;
  if (!execute && envName !== "NEAR_ROOT_KEY") return null;
  const secret = KeyPair.fromRandom("ed25519").toString() as KeyPairString;
  appendFileSync(ENV_PATH, `${envName}=${secret}\n`, { mode: 0o600 });
  process.env[envName] = secret;
  return secret;
}

function setValue(envName: string, value: string) {
  if (!execute || process.env[envName] || readEnvFile()[envName]) return;
  appendFileSync(ENV_PATH, `${envName}=${value}\n`, { mode: 0o600 });
}

async function balance(accountId: string): Promise<bigint | null> {
  try {
    return BigInt((await provider.viewAccount({ accountId })).amount);
  } catch (err) {
    if (/does not exist|UNKNOWN_ACCOUNT/.test(String(err))) return null;
    throw err;
  }
}

async function usdcContract(): Promise<string> {
  const res = await fetch(`${ONECLICK}/v0/tokens`);
  if (!res.ok) throw new Error(`1Click tokens: ${res.status}`);
  const tokens = (await res.json()) as Array<{ blockchain: string; symbol: string; contractAddress?: string }>;
  const usdc = tokens.find((t) => t.blockchain === "near" && t.symbol === "USDC");
  if (!usdc?.contractAddress) throw new Error("1Click lists no USDC on NEAR");
  return usdc.contractAddress;
}

const near = (yocto: bigint) => (Number(yocto / 10n ** 20n) / 10_000).toFixed(4);

async function main() {
  if (!existsSync(ENV_PATH)) appendFileSync(ENV_PATH, "# --- NEAR mainnet (written by npm run near:setup:mainnet) ---\n", { mode: 0o600 });
  const usdc = await usdcContract();
  const rootKey = key("NEAR_ROOT_KEY")!;
  const rootPublic = KeyPair.fromString(rootKey).getPublicKey().toString();
  const need = CHILDREN.reduce((sum, c) => sum + nearToYocto(c.near), nearToYocto(ROOT_RESERVE));
  const rootBalance = await balance(root);

  console.log(`${execute ? "EXECUTING" : "Plan only (nothing is sent)"} on NEAR mainnet\n`);
  console.log(`USDC on NEAR (from 1Click): ${usdc}`);
  console.log(`Root ${root}: ${rootBalance === null ? "does not exist yet" : `${near(rootBalance)} NEAR`}`);
  console.log(`Root needs this full-access public key: ${rootPublic}\n`);
  for (const c of CHILDREN) {
    const id = `${c.prefix}.${root}`;
    const have = await balance(id);
    console.log(`  ${id.padEnd(26)} ${have === null ? `create with ${c.near} NEAR` : `exists, ${near(have)} NEAR`}  (${c.why})`);
  }
  console.log(`\nTotal to fund the root with: ${near(need)} NEAR, plus a little for gas.`);

  let rootReady = false;
  if (rootBalance !== null) {
    const keys = await listAccessKeys(provider, root);
    rootReady = keys.some((k) => k.publicKey === rootPublic);
    if (!rootReady) console.log(`\n${root} exists but does not have the key above yet. Add it in the wallet that owns ${root}.`);
    else if (rootBalance < need) console.log(`\n${root} holds ${near(rootBalance)} NEAR; it needs ${near(need)}.`);
  } else {
    console.log(`\nNext: create ${root} in a NEAR wallet, add the public key above as a full-access key, and fund it.`);
  }

  if (!execute) {
    console.log("\nNothing was sent. Re-run with SELKIE_MAINNET_OK=yes and --execute once the root is funded.");
    return;
  }
  if (!rootReady) throw new Error(`${root} is not ready: it must exist and hold the key above.`);
  if (rootBalance! < need) throw new Error(`${root} needs ${near(need)} NEAR before setup can run.`);

  setValue("NEAR_NETWORK", "mainnet");
  setValue("NEAR_RPC_URL", RPC);
  setValue("NEAR_EXPLORER_URL", EXPLORER);
  setValue("NEAR_ROOT_ACCOUNT", root);
  setValue("NEAR_USDC_CONTRACT", usdc);
  const rootAccount = new Account(root, provider, rootKey);
  const escrowId = `escrow.${root}`;
  for (const c of CHILDREN) {
    const id = `${c.prefix}.${root}`;
    const secret = key(c.env.replace(/_ACCOUNT$|_CONTRACT$/, "") + "_KEY")!;
    setValue(c.env, id);
    if ((await balance(id)) !== null) continue;
    const publicKey = KeyPair.fromString(secret).getPublicKey();
    const access = "oracle" in c ? actions.addFunctionCallAccessKey(publicKey, escrowId, ["claim"]) : actions.addFullAccessKey(publicKey);
    const out = await rootAccount.signAndSendTransaction({
      receiverId: id,
      actions: [actions.createAccount(), actions.transfer(nearToYocto(c.near)), access],
    });
    console.log(`created ${id}: ${EXPLORER}/transactions/${out.transaction.hash}`);
  }

  // The escrow holds USDC, so it pays for its USDC storage row once.
  const registered = await provider.callFunction({ contractId: usdc, method: "storage_balance_of", args: { account_id: escrowId } });
  if (!registered) {
    const bounds = await provider.callFunction<{ min: string }>({ contractId: usdc, method: "storage_balance_bounds", args: {} });
    await rootAccount.callFunction({
      contractId: usdc,
      methodName: "storage_deposit",
      args: { account_id: escrowId, registration_only: true },
      deposit: BigInt(bounds!.min),
      gas: 30_000_000_000_000n,
    });
    console.log(`registered ${escrowId} with USDC`);
  }
  console.log("\nNext: build the escrow and run npm run near:deploy-escrow:mainnet.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
