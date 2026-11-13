/**
 * Create, deploy and initialise the pocket contract on testnet.
 *
 *   npm run build:contracts:near && npm run near:deploy-pocket
 *
 * Accounts (children of NEAR_ROOT_ACCOUNT, created by it):
 *
 *   pocket.selkiepay.testnet     the contract. Its full-access key (NEAR_POCKET_KEY)
 *                                is only used here, to deploy and to call `new`.
 *   pocketbot.selkiepay.testnet  the X bot. Its only key (NEAR_POCKET_BOT_KEY) is a
 *                                function-call key for pocket_send on the pocket and
 *                                nothing else: it cannot attach a deposit, so it
 *                                cannot withdraw, set a cap, or move its own NEAR.
 *
 * Steps, each skipped when already done, so re-running is safe:
 *  1. Keys: reused from .env, or generated and APPENDED to it. Never printed.
 *  2. Create both accounts. The pocket is topped up to MIN_BALANCE from the
 *     testnet faucet (it pays for its ~200 KB of code and every pocket record);
 *     if the faucet is down the root pays instead.
 *  3. Deploy the build, unless the deployed code hash already matches it.
 *  4. `new(owner = root, bot, token = USDC, handle_parent)`, signed by the pocket
 *     itself: `new` is #[private], so nobody can front-run it and name their bot.
 *  5. Register the pocket on USDC (storage_deposit), paid by the root.
 *
 * Testnet only. A state layout change needs a fresh pocket account.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Account, KeyPair, actions, baseEncode, nearToYocto, type KeyPairString } from "near-api-js";
import { failoverProvider, rpcUrls } from "../src/rpc";
import { listAccessKeys } from "../src/keys";
import { balanceOf, topUpFromFaucet } from "./faucet";

const ENV_PATH = resolve(import.meta.dirname, "../../../.env");
const WASM = resolve(import.meta.dirname, "../../../contracts-near/target/wasm32-unknown-unknown/release/selkie_pocket.wasm");
const EXPLORER = process.env.NEAR_EXPLORER_URL || "https://explorer.testnet.near.org";
/** ~2.0 NEAR of code storage, the 0.5 NEAR the contract keeps spare, and room for pocket records. */
const MIN_BALANCE = nearToYocto("3");
const BOT_BALANCE = nearToYocto("0.5");
const TGAS = 1_000_000_000_000n;

const root = required("NEAR_ROOT_ACCOUNT");
if (!root.endsWith(".testnet")) throw new Error(`The pocket deploy is testnet only; NEAR_ROOT_ACCOUNT is ${root}`);
const rootKey = required("NEAR_ROOT_KEY") as KeyPairString;
const usdc = required("NEAR_USDC_CONTRACT");
const handleParent = required("NEAR_HANDLE_PARENT");
const provider = failoverProvider(rpcUrls(required("NEAR_RPC_URL")));
const rootAccount = new Account(root, provider, rootKey);
const tx = (hash: string) => `${EXPLORER}/transactions/${hash}`;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} missing from .env (run npm run near:setup)`);
  return value;
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

/**
 * Append `name=value` to .env unless it is already set. Append only: other
 * processes read this file, and rewriting it could drop their settings.
 */
function appendEnv(name: string, value: string) {
  const text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const lead = text === "" || text.endsWith("\n") ? "" : "\n";
  appendFileSync(ENV_PATH, `${lead}${name}=${value}\n`, { mode: 0o600 });
  process.env[name] = value;
}

function ensureValue(name: string, fallback: string): string {
  const existing = process.env[name] || readEnvFile()[name];
  if (existing) return existing;
  appendEnv(name, fallback);
  return fallback;
}

/** Reuse a key already in .env, or make one and append it. Returns the secret, never logs it. */
function ensureKey(name: string): KeyPairString {
  const existing = process.env[name] || readEnvFile()[name];
  if (existing) return existing as KeyPairString;
  const secret = KeyPair.fromRandom("ed25519").toString() as KeyPairString;
  appendEnv(name, secret);
  return secret;
}

async function exists(accountId: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch (error) {
    if (/does not exist|UNKNOWN_ACCOUNT/i.test(String(error))) return false;
    throw error;
  }
}

async function main() {
  const pocketId = ensureValue("NEAR_POCKET_CONTRACT", `pocket.${root}`);
  const botId = ensureValue("NEAR_POCKET_BOT_ACCOUNT", `pocketbot.${root}`);
  const pocketKey = ensureKey("NEAR_POCKET_KEY");
  const botKey = ensureKey("NEAR_POCKET_BOT_KEY");
  for (const id of [pocketId, botId]) {
    if (!id.endsWith(`.${root}`)) throw new Error(`${id} is not a child of ${root}; the root creates it`);
  }

  // 2. accounts
  if (await exists(pocketId)) {
    console.log(`exists  ${pocketId}`);
  } else {
    const created = await rootAccount.signAndSendTransaction({
      receiverId: pocketId,
      actions: [
        actions.createAccount(),
        actions.transfer(nearToYocto("0.2")),
        actions.addFullAccessKey(KeyPair.fromString(pocketKey).getPublicKey()),
      ],
    });
    console.log(`created ${pocketId}: ${tx(created.transaction.hash)}`);
  }
  try {
    for (const hash of await topUpFromFaucet(provider, pocketId, MIN_BALANCE)) {
      console.log(`topped up ${pocketId} from the faucet: ${tx(hash)}`);
    }
  } catch (error) {
    const short = MIN_BALANCE - (await balanceOf(provider, pocketId));
    if (short > 0n) {
      console.log(`faucet unavailable (${error instanceof Error ? error.message : error}); the root pays instead`);
      const paid = await rootAccount.transfer({ receiverId: pocketId, amount: short });
      console.log(`topped up ${pocketId} from ${root}: ${tx(paid.transaction.hash)}`);
    }
  }

  const botPublic = KeyPair.fromString(botKey).getPublicKey();
  if (await exists(botId)) {
    console.log(`exists  ${botId}`);
  } else {
    const created = await rootAccount.signAndSendTransaction({
      receiverId: botId,
      actions: [
        actions.createAccount(),
        actions.transfer(BOT_BALANCE),
        // pocket_send on the pocket, nothing else. No allowance cap: an
        // allowance only shrinks, so a capped key dies after enough sends;
        // the account's 0.5 NEAR is the bound instead.
        actions.addFunctionCallAccessKey(botPublic, pocketId, ["pocket_send"]),
      ],
    });
    console.log(`created ${botId}: ${tx(created.transaction.hash)}`);
  }
  // Keys are read at final; a key added a moment ago can take a few blocks to show.
  let botKeys = await listAccessKeys(provider, botId);
  for (let i = 0; i < 10 && !botKeys.some((key) => key.publicKey === botPublic.toString()); i++) {
    await new Promise((r) => setTimeout(r, 1500));
    botKeys = await listAccessKeys(provider, botId);
  }
  const fcOnly = botKeys.every(
    (key) =>
      key.permission !== "full" &&
      key.permission.receiverId === pocketId &&
      key.permission.methodNames.length === 1 &&
      key.permission.methodNames[0] === "pocket_send",
  );
  if (!botKeys.some((key) => key.publicKey === botPublic.toString())) {
    throw new Error(`${botId} does not hold NEAR_POCKET_BOT_KEY`);
  }
  console.log(`${botId} keys: ${fcOnly ? "pocket_send on " + pocketId + " only" : JSON.stringify(botKeys)}`);

  // 3. code
  const code = readFileSync(WASM);
  const hash = baseEncode(createHash("sha256").update(code).digest());
  const view = await provider.viewAccount({ accountId: pocketId });
  const pocket = new Account(pocketId, provider, pocketKey);
  if (view.code_hash === hash) {
    console.log(`code    ${hash} already deployed`);
  } else {
    const deployed = await pocket.deployContract(code);
    console.log(`deployed ${code.length} bytes (${hash}): ${tx(deployed.transaction.hash)}`);
  }

  // 4. init
  const config = await provider
    .callFunction({ contractId: pocketId, method: "get_config", args: {} })
    .catch(() => null);
  if (!config) {
    const init = await pocket.callFunctionRaw({
      contractId: pocketId,
      methodName: "new",
      args: { owner: root, bot: botId, token: usdc, handle_parent: handleParent },
      gas: 30n * TGAS,
    });
    console.log(`initialised: ${tx(init.transaction.hash)}`);
  }

  // 5. USDC storage, so top-ups and refunds of failed sends can land.
  const registered = await provider.callFunction({
    contractId: usdc,
    method: "storage_balance_of",
    args: { account_id: pocketId },
  });
  if (registered) {
    console.log(`exists  USDC storage for ${pocketId}`);
  } else {
    const bounds = (await provider.callFunction({ contractId: usdc, method: "storage_balance_bounds", args: {} })) as {
      min: string;
    };
    const deposit = await rootAccount.callFunctionRaw({
      contractId: usdc,
      methodName: "storage_deposit",
      args: { account_id: pocketId, registration_only: true },
      deposit: BigInt(bounds.min),
      gas: 30n * TGAS,
    });
    console.log(`USDC storage for ${pocketId}: ${tx(deposit.transaction.hash)}`);
  }

  console.log("config", JSON.stringify(await provider.callFunction({ contractId: pocketId, method: "get_config", args: {} })));
  for (const id of [pocketId, botId]) {
    const near = Number((await balanceOf(provider, id)) / 10n ** 20n) / 10_000;
    console.log(`  ${id.padEnd(30)} ${near.toFixed(4)} NEAR  ${EXPLORER}/accounts/${id}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
