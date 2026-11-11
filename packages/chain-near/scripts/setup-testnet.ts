/**
 * One-time testnet setup for Selkie on NEAR. Run it once from the repo root:
 *
 *   npm run near:setup
 *
 * It creates the accounts Selkie runs on, named so the explorer reads cleanly:
 *
 *   selkiepay.testnet            root, owns the rest (created by the testnet faucet)
 *   x.selkiepay.testnet          parent of every handle account; only ever creates accounts
 *   escrow.selkiepay.testnet     where the handle-escrow contract lives
 *   relayer.selkiepay.testnet    pays gas for the delegate actions users sign
 *   oracle.selkiepay.testnet     releases escrowed money after a proven X login
 *
 * Safe to re-run: an account that already exists is left alone, and a key that is
 * already in .env is reused rather than replaced. Keys are generated here and
 * appended to .env (gitignored). They are never printed, because a key in a
 * terminal scrollback or a CI log is a key someone else has.
 *
 * The oracle gets no full-access key at all, only a function-call key that can
 * call `claim` on the escrow and nothing else. That is the whole point of the
 * trust model: the most powerful thing the oracle's key can do is the one thing
 * it exists to do.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, type KeyPairString } from "near-api-js";

const ENV_PATH = resolve(import.meta.dirname, "../../../.env");
const FAUCET_URL = "https://helper.nearprotocol.com/account";
const EXPLORER = "https://explorer.testnet.near.org/accounts";
const CIRCLE_TESTNET_USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";

const rpcUrl = process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com";
const root = process.env.NEAR_ROOT_ACCOUNT || "selkiepay.testnet";
const provider = new JsonRpcProvider({ url: rpcUrl });

if (!root.endsWith(".testnet")) {
  // Mainnet accounts cost real money and need the human's OK. This script never makes one.
  throw new Error(`NEAR_ROOT_ACCOUNT must be a .testnet account, got ${root}`);
}

/** Reuse a key already in .env, or make one and append it. Returns the secret. */
function ensureKey(envName: string): KeyPairString {
  const existing = process.env[envName] || readEnvFile()[envName];
  if (existing) return existing as KeyPairString;
  const secret = KeyPair.fromRandom("ed25519").toString() as KeyPairString;
  appendFileSync(ENV_PATH, `${envName}=${secret}\n`, { mode: 0o600 });
  process.env[envName] = secret;
  return secret;
}

/** Set a non-secret value in .env if it is not already there. */
function ensureEnvValue(envName: string, value: string) {
  if (process.env[envName] || readEnvFile()[envName]) return;
  appendFileSync(ENV_PATH, `${envName}=${value}\n`, { mode: 0o600 });
  process.env[envName] = value;
}

function readEnvFile(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2]) out[m[1]!] = m[2];
  }
  return out;
}

async function exists(accountId: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch (err) {
    if (String(err).includes("does not exist") || String(err).includes("UNKNOWN_ACCOUNT")) return false;
    throw err;
  }
}

async function waitFor(accountId: string) {
  for (let i = 0; i < 30; i++) {
    if (await exists(accountId)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${accountId} did not appear after 30s`);
}

async function main() {
  appendSectionHeader();
  ensureEnvValue("NEAR_NETWORK", "testnet");
  ensureEnvValue("NEAR_RPC_URL", rpcUrl);
  ensureEnvValue("NEAR_ROOT_ACCOUNT", root);

  const rootKey = ensureKey("NEAR_ROOT_KEY");
  if (!(await exists(root))) {
    // The testnet faucet creates top-level .testnet accounts and funds them.
    // It is the same service `near account create-account sponsor-by-faucet-service` calls.
    const publicKey = KeyPair.fromString(rootKey).getPublicKey().toString();
    const res = await fetch(FAUCET_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newAccountId: root, newAccountPublicKey: publicKey }),
    });
    if (!res.ok) throw new Error(`Faucet refused ${root}: ${res.status} ${await res.text()}`);
    await waitFor(root);
    console.log(`created ${root} via the testnet faucet`);
  } else {
    console.log(`exists  ${root}`);
  }
  const rootAccount = new Account(root, provider, rootKey);

  // Amounts are what each account needs to do its job on testnet, with headroom.
  // The escrow pays storage for its own code and records; the relayer pays gas and
  // each new user's USDC storage deposit (0.00125 NEAR, from storage_balance_bounds).
  const children: Array<{ prefix: string; env: string; near: string; oracle?: boolean }> = [
    { prefix: "x", env: "NEAR_HANDLE_PARENT", near: "1" },
    { prefix: "escrow", env: "NEAR_ESCROW_CONTRACT", near: "3" },
    { prefix: "relayer", env: "NEAR_RELAYER_ACCOUNT", near: "2" },
    { prefix: "oracle", env: "NEAR_ORACLE_ACCOUNT", near: "0.5", oracle: true },
  ];

  const escrowId = `escrow.${root}`;
  for (const child of children) {
    const accountId = `${child.prefix}.${root}`;
    const keyEnv = keyEnvFor(child.env);
    const secret = ensureKey(keyEnv);
    ensureEnvValue(child.env, accountId);
    if (await exists(accountId)) {
      console.log(`exists  ${accountId}`);
      continue;
    }
    const publicKey = KeyPair.fromString(secret).getPublicKey();
    const accessKey = child.oracle
      ? // Function-call key: may call escrow.claim, nothing else, and can never attach a deposit.
        actions.addFunctionCallAccessKey(publicKey, escrowId, ["claim"], nearToYocto("0.25"))
      : actions.addFullAccessKey(publicKey);
    await rootAccount.signAndSendTransaction({
      receiverId: accountId,
      actions: [actions.createAccount(), actions.transfer(nearToYocto(child.near)), accessKey],
    });
    console.log(`created ${accountId} (${child.near} NEAR)`);
  }

  // Circle's testnet USDC (developers.circle.com/stablecoins/usdc-contract-addresses).
  // A NEP-141 token only accepts balances for accounts that have paid for their
  // storage row, so the accounts that hold USDC register once here.
  ensureEnvValue("NEAR_USDC_CONTRACT", CIRCLE_TESTNET_USDC);
  const usdc = process.env.NEAR_USDC_CONTRACT!;
  const bounds = await provider.callFunction<{ min: string }>({
    contractId: usdc,
    method: "storage_balance_bounds",
    args: {},
  });
  for (const holder of [root, escrowId]) {
    const balance = await provider.callFunction({ contractId: usdc, method: "storage_balance_of", args: { account_id: holder } });
    if (balance) {
      console.log(`exists  USDC storage for ${holder}`);
      continue;
    }
    await rootAccount.callFunction({
      contractId: usdc,
      methodName: "storage_deposit",
      args: { account_id: holder, registration_only: true },
      deposit: BigInt(bounds!.min),
      gas: 30_000_000_000_000n,
    });
    console.log(`created USDC storage for ${holder}`);
  }

  console.log("\nAccounts:");
  for (const id of [root, ...children.map((c) => `${c.prefix}.${root}`)]) {
    const view = await provider.viewAccount({ accountId: id });
    console.log(`  ${id.padEnd(28)} ${formatNear(BigInt(view.amount))} NEAR  ${EXPLORER}/${id}`);
  }
}

function keyEnvFor(accountEnv: string): string {
  // NEAR_HANDLE_PARENT -> NEAR_HANDLE_PARENT_KEY, NEAR_RELAYER_ACCOUNT -> NEAR_RELAYER_KEY, ...
  return accountEnv.replace(/_ACCOUNT$|_CONTRACT$/, "") + "_KEY";
}

function formatNear(yocto: bigint): string {
  const whole = yocto / 10n ** 24n;
  const frac = ((yocto % 10n ** 24n) / 10n ** 20n).toString().padStart(4, "0");
  return `${whole}.${frac}`;
}

function appendSectionHeader() {
  if (readFileSync(ENV_PATH, "utf8").includes("# --- NEAR")) return;
  appendFileSync(ENV_PATH, "\n# --- NEAR (written by npm run near:setup) ---\n", { mode: 0o600 });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
