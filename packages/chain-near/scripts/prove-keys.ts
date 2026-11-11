/**
 * Who can sign for this account? Prove Selkie can't.
 *
 *   npm run prove:keys -- amaka.x.selkiepay.testnet
 *
 * Reads the account's access keys from the chain, then reads every key on every
 * account Selkie operates (the root and its x., relayer., oracle. and escrow.
 * children, plus whichever oracle the escrow contract names right now), also
 * from the chain, and says whether the two lists share a key.
 * Needs no secrets and no Selkie server: anyone can run it, and the explorer
 * link at the end shows the same thing without running anything.
 *
 * Exit code 0: Selkie holds no key to the account. 2: it holds at least one.
 */
import { JsonRpcProvider } from "near-api-js";
import { listAccessKeys, selkieAccounts, type AccessKeySummary } from "../src/keys";

const NETWORKS = {
  testnet: { rpc: "https://test.rpc.fastnear.com", explorer: "https://explorer.testnet.near.org", root: "selkiepay.testnet" },
} as const;

const accountId = process.argv[2]?.trim();
if (!accountId) {
  console.error("Usage: npm run prove:keys -- <account id>   e.g. amaka.x.selkiepay.testnet");
  process.exit(1);
}

const network = NETWORKS.testnet;
const rpcUrl = process.env.NEAR_RPC_URL ?? network.rpc;
const root = process.env.NEAR_ROOT_ACCOUNT ?? network.root;
const explorer = (process.env.NEAR_EXPLORER_URL ?? network.explorer).replace(/\/$/, "");
const provider = new JsonRpcProvider({ url: rpcUrl });

const describe = (key: AccessKeySummary) =>
  key.permission === "full"
    ? "full access"
    : `function call only: ${key.permission.receiverId} ${key.permission.methodNames.join(", ") || "(any method)"}`;

async function keysOrNone(id: string): Promise<AccessKeySummary[]> {
  // An operator account that does not exist holds no keys; that is not an error.
  return listAccessKeys(provider, id).catch(() => []);
}

/**
 * The oracle the escrow answers to today, read from the contract itself. The
 * oracle can be rotated (scripts/rotate-oracle.ts), and asking the contract
 * means a new one is never missed because a list here went stale.
 */
async function currentOracle(): Promise<string | null> {
  const config = await provider
    .callFunction<{ oracle: string }>({ contractId: `escrow.${root}`, method: "get_config", args: {} })
    .catch(() => null);
  return config?.oracle ?? null;
}

async function main() {
  const keys = await listAccessKeys(provider, accountId!);
  const oracle = await currentOracle();
  const operators = [...new Set([...selkieAccounts(root), ...(oracle ? [oracle] : [])])];
  const selkie = new Map<string, string>();
  for (const operator of operators) {
    for (const key of await keysOrNone(operator)) selkie.set(key.publicKey, operator);
  }

  console.log(`Account   ${accountId}`);
  console.log(`Keys      ${keys.length} on chain (RPC ${rpcUrl})`);
  for (const key of keys) {
    const owner = selkie.get(key.publicKey);
    console.log(`  ${key.publicKey}  ${describe(key)}${owner ? `  <- SELKIE'S (${owner})` : ""}`);
  }
  console.log(`Selkie    ${selkie.size} keys across ${operators.join(", ")}`);

  const shared = keys.filter((key) => selkie.has(key.publicKey));
  console.log("");
  if (shared.length === 0) {
    console.log(`Result    Selkie holds no key to this account. It cannot sign for ${accountId}.`);
  } else {
    console.log(`Result    Selkie holds ${shared.length} of this account's keys.`);
  }
  console.log(`Check     ${explorer}/accounts/${accountId}`);
  process.exit(shared.length === 0 ? 0 : 2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
