/**
 * Lock the escrow: delete every access key on its account, so its code can
 * never change again. Not by Selkie, not by anyone.
 *
 *   npm run near:lock-escrow           what it would do, signs nothing
 *   npm run near:lock-escrow -- --yes  do it (cannot be undone)
 *
 * Why: while the escrow account holds a full-access key, whoever has that key
 * can deploy different code and walk off with every payment waiting in it.
 * With no keys, the code on chain is the code forever, and the only ways money
 * leaves are the ones it already has: the oracle's claim to a signed-in
 * account, and the sender's refund after expiry. The owner keeps its
 * 1-yoctoNEAR methods (set_oracle, add_token, remove_token, set_min_hold);
 * those are calls the contract allows, not keys to the account.
 *
 * Before deleting anything it checks that the code on chain is the code in
 * this repo (sha256 of the local build, as NEAR stores it) and that the
 * contract is initialised. Callbacks still work: the contract calls itself
 * through promises, which needs no key. Anyone can still send it NEAR for
 * storage. A fix after this means a new escrow account.
 *
 * Testnet only for now: mainnet is never touched without the human's OK.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, JsonRpcProvider, KeyPair, PublicKey, actions, baseEncode, type KeyPairString } from "near-api-js";
import { nearConfigFromEnv } from "../src/config";
import { listAccessKeys } from "../src/keys";

const WASM = resolve(import.meta.dirname, "../../../contracts-near/target/wasm32-unknown-unknown/release/selkie_handle_escrow.wasm");
/** Enough for thousands more payment records at ~0.01 NEAR per 1 KB. */
const MIN_SPARE_NEAR = 2;

const config = nearConfigFromEnv();
if (config.network !== "testnet") throw new Error("near:lock-escrow runs on testnet only.");
const provider = new JsonRpcProvider({ url: config.rpcUrl });
const escrowId = config.escrowContract;
const yes = process.argv.includes("--yes");

/** Every key on `accountId`, deleted in one transaction signed by `key`, which must be one of them. */
export async function deleteAllKeys(accountId: string, key: KeyPairString): Promise<string> {
  const keys = await listAccessKeys(provider, accountId);
  if (keys.length === 0) throw new Error(`${accountId} has no keys left to delete.`);
  const mine = KeyPair.fromString(key).getPublicKey().toString();
  if (!keys.some((candidate) => candidate.publicKey === mine)) throw new Error(`That key is not on ${accountId}.`);
  // The signing key goes last; the transaction was checked against it before it ran.
  const ordered = [...keys.filter((k) => k.publicKey !== mine), ...keys.filter((k) => k.publicKey === mine)];
  const result = await new Account(accountId, provider, key).signAndSendTransaction({
    receiverId: accountId,
    actions: ordered.map((k) => actions.deleteKey(PublicKey.fromString(k.publicKey))),
  });
  return result.transaction.hash;
}

async function main() {
  const view = await provider.viewAccount({ accountId: escrowId });
  const onChain = String(view.code_hash);
  const built = existsSync(WASM) ? baseEncode(createHash("sha256").update(readFileSync(WASM)).digest()) : null;
  console.log(`escrow   ${escrowId}`);
  console.log(`code     ${onChain} on chain`);
  console.log(`build    ${built ?? "(no local build: npm run build:contracts:near)"} in this repo`);
  if (built !== onChain) throw new Error("The code on chain is not this repo's build. Deploy it first, or find out why.");

  const contractConfig = await provider
    .callFunction({ contractId: escrowId, method: "get_config", args: {} })
    .catch(() => null);
  if (!contractConfig) throw new Error("The escrow does not answer get_config: it is not initialised. Locking it now would brick it.");
  console.log(`config   ${JSON.stringify(contractConfig)}`);

  const spare = Number((BigInt(view.amount) - BigInt(view.storage_usage) * 10n ** 19n) / 10n ** 21n) / 1000;
  console.log(`balance  ${spare.toFixed(3)} NEAR spare after storage`);
  if (spare < MIN_SPARE_NEAR) {
    console.log(`warning  under ${MIN_SPARE_NEAR} NEAR spare; anyone can still send it NEAR later, but top it up first if you can.`);
  }

  const keys = await listAccessKeys(provider, escrowId);
  for (const key of keys) console.log(`key      ${key.publicKey} ${key.permission === "full" ? "full access" : "function call"}`);
  if (keys.length === 0) {
    console.log("\nAlready locked: no keys. Nothing to do.");
    return;
  }

  if (!yes) {
    console.log(`\nDry run. With --yes this deletes ${keys.length} key(s) in one transaction, and nobody can sign for ${escrowId} again.`);
    return;
  }
  const escrowKey = process.env.NEAR_ESCROW_KEY as KeyPairString | undefined;
  if (!escrowKey) throw new Error("NEAR_ESCROW_KEY missing from .env: only the escrow's own key can delete its keys.");
  const hash = await deleteAllKeys(escrowId, escrowKey);
  const after = await listAccessKeys(provider, escrowId);
  console.log(`\nlocked   ${config.explorerUrl}/transactions/${hash}`);
  console.log(`keys     ${after.length} left (${config.explorerUrl}/accounts/${escrowId})`);
  if (after.length !== 0) throw new Error("Keys are still on the account. Look at the transaction above.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`FAIL ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
