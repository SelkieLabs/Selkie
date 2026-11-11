/**
 * Move the escrow to a new oracle account. Testnet only.
 *
 *   npm run near:rotate-oracle -- oracle-v2
 *
 * Why it exists: a function-call key's gas allowance only ever goes down. Each
 * claim reserves 300 Tgas (about 0.03 NEAR) against it, and unused gas is
 * refunded to the account's balance, never to the allowance. The first
 * oracle's key had a 0.25 NEAR allowance, so it would have stopped after about
 * eight claims, and nothing can raise it: by design the oracle has no
 * full-access key that could add a new one.
 *
 * The fix is a new account whose claim-only key has no allowance cap. It pays
 * only the gas a claim actually burns, from the account's own balance, and that
 * balance is the bound on what a stolen key could waste. The key still cannot
 * call anything but `escrow.claim` or attach a deposit.
 *
 * Steps, each skipped when already done, so a failed run can simply be re-run:
 *   1. create <prefix>.<root> with a fresh claim-only key (kept in .env, never printed)
 *   2. escrow.set_oracle(<prefix>.<root>), signed by the owner (the root account)
 *   3. point NEAR_ORACLE_ACCOUNT and NEAR_ORACLE_KEY in .env at it
 *
 * The old oracle account keeps its key, so `selkieAccounts` keeps listing it and
 * `prove:keys` still counts that key as Selkie's.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, type KeyPairString } from "near-api-js";

const ENV_PATH = resolve(import.meta.dirname, "../../../.env");
const NEXT_KEY = "NEAR_ORACLE_NEXT_KEY";
/** Enough for hundreds of claims at the gas they actually burn. */
const FUNDING = "2";

const prefix = process.argv[2];
if (!prefix || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(prefix)) {
  throw new Error("Usage: npm run near:rotate-oracle -- <new-prefix>, e.g. oracle-v2");
}
const rpcUrl = process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com";
const root = process.env.NEAR_ROOT_ACCOUNT;
const rootKey = process.env.NEAR_ROOT_KEY as KeyPairString | undefined;
const escrowId = process.env.NEAR_ESCROW_CONTRACT;
if (!root || !rootKey || !escrowId) throw new Error("NEAR_ROOT_ACCOUNT, NEAR_ROOT_KEY and NEAR_ESCROW_CONTRACT are needed.");
if (!root.endsWith(".testnet")) throw new Error("rotate-oracle only runs on testnet.");

const provider = new JsonRpcProvider({ url: rpcUrl });
const owner = new Account(root, provider, rootKey);
const oracleId = `${prefix}.${root}`;

function envLines(): string[] {
  return existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8").split("\n") : [];
}

function envValue(name: string): string | undefined {
  const line = envLines().find((entry) => entry.startsWith(`${name}=`));
  return line?.slice(name.length + 1) || undefined;
}

/** Replace (or add) these values and drop `remove`, in one write. Secrets never reach stdout. */
function writeEnv(values: Record<string, string>, remove: string[] = []) {
  const pending = new Map(Object.entries(values));
  const lines = envLines()
    .filter((line) => !remove.some((name) => line.startsWith(`${name}=`)))
    .map((line) => {
      const name = line.split("=", 1)[0]!;
      if (!pending.has(name)) return line;
      const value = pending.get(name)!;
      pending.delete(name);
      return `${name}=${value}`;
    });
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  for (const [name, value] of pending) lines.push(`${name}=${value}`);
  writeFileSync(ENV_PATH, `${lines.join("\n")}\n`, { mode: 0o600 });
}

async function exists(accountId: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId, blockQuery: { finality: "final" } });
    return true;
  } catch (error) {
    if (/does not exist|UNKNOWN_ACCOUNT/.test(String(error))) return false;
    throw error;
  }
}

async function main() {
  // 1. The account and its key. The key is saved before the account exists, so a
  //    crash between the two never leaves an account nobody can sign for.
  let secret = envValue(NEXT_KEY) as KeyPairString | undefined;
  if (envValue("NEAR_ORACLE_ACCOUNT") === oracleId) secret ??= envValue("NEAR_ORACLE_KEY") as KeyPairString;
  if (!secret) {
    secret = KeyPair.fromRandom("ed25519").toString() as KeyPairString;
    writeEnv({ [NEXT_KEY]: secret });
  }
  const publicKey = KeyPair.fromString(secret).getPublicKey();
  if (await exists(oracleId)) {
    // Only adopt an existing account if it carries our key; otherwise the escrow
    // would answer to an account nobody here can sign for.
    const keys = await provider.viewAccessKeyList({ accountId: oracleId, finalityQuery: { finality: "final" } });
    if (!keys.keys.some((key) => key.public_key === publicKey.toString())) {
      throw new Error(`${oracleId} exists without our key. Pick another prefix.`);
    }
    console.log(`exists   ${oracleId}`);
  } else {
    await owner.signAndSendTransaction({
      receiverId: oracleId,
      actions: [
        actions.createAccount(),
        actions.transfer(nearToYocto(FUNDING)),
        // No allowance argument: no cap. Still only escrow.claim, still no deposit.
        actions.addFunctionCallAccessKey(publicKey, escrowId!, ["claim"]),
      ],
    });
    console.log(`created  ${oracleId} (${FUNDING} NEAR, claim-only key, no allowance cap)`);
  }

  // 2. The escrow listens to the new oracle.
  const config = await provider.callFunction<{ oracle: string; owner: string }>({
    contractId: escrowId!,
    method: "get_config",
    args: {},
  });
  if (!config || config.owner !== root) throw new Error(`${escrowId} is owned by ${config?.owner}, not ${root}.`);
  if (config.oracle === oracleId) {
    console.log(`escrow   already answers to ${oracleId}`);
  } else {
    await owner.callFunction({
      contractId: escrowId!,
      methodName: "set_oracle",
      args: { oracle: oracleId },
      gas: 30_000_000_000_000n,
    });
    console.log(`escrow   oracle ${config.oracle} -> ${oracleId}`);
  }

  // 3. The API signs claims with the new key from now on.
  writeEnv({ NEAR_ORACLE_ACCOUNT: oracleId, NEAR_ORACLE_KEY: secret }, [NEXT_KEY]);
  console.log(".env     NEAR_ORACLE_ACCOUNT and NEAR_ORACLE_KEY updated. Restart the API.");

  const keys = await provider.viewAccessKeyList({ accountId: oracleId, finalityQuery: { finality: "final" } });
  for (const key of keys.keys) {
    console.log(`key      ${key.public_key} ${JSON.stringify(key.access_key.permission)}`);
  }
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
