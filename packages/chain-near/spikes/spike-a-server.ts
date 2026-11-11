/**
 * Spike A, part 1: can a Privy NEAR wallet sign a NEP-366 delegate action that
 * NEAR accepts, when the account's ONLY key is that Privy wallet's key?
 *
 * This half runs without a browser. It uses a Privy app-owned NEAR wallet so the
 * whole loop can run from a script; the browser half (spike-a page) proves the
 * same thing for a user-owned embedded wallet via useSignRawHash. Both end in the
 * same Privy raw_sign over the same 32-byte hash, so this half pins down the hard
 * part: hash format, signature format, and on-chain acceptance.
 *
 * Throwaway. Not product code.
 *
 *   npx tsx --env-file=.env packages/chain-near/spikes/spike-a-server.ts
 */
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, JsonRpcProvider, KeyPair, PublicKey, Signer, actions, nearToYocto } from "near-api-js";
import { ed25519 } from "@noble/curves/ed25519.js";

const ENV_PATH = resolve(import.meta.dirname, "../../../.env");
const EXPLORER = "https://explorer.testnet.near.org";
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} missing from .env`);
  return v;
};

const provider = new JsonRpcProvider({ url: env("NEAR_RPC_URL") });
const privyAuth = `Basic ${Buffer.from(`${env("PRIVY_APP_ID")}:${env("PRIVY_APP_SECRET")}`).toString("base64")}`;

async function privy<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.privy.io${path}`, {
    method: "POST",
    headers: { authorization: privyAuth, "privy-app-id": env("PRIVY_APP_ID"), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Privy ${path} ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

interface PrivyWallet {
  id: string;
  address: string;
  chain_type: string;
  public_key?: string;
}

/** A near-api-js Signer whose key lives in Privy. It never sees a private key. */
class PrivyRawSigner extends Signer {
  constructor(
    private readonly walletId: string,
    private readonly publicKey: PublicKey,
  ) {
    super();
  }
  async getPublicKey() {
    return this.publicKey;
  }
  // near-api-js hands us sha256(NEP-461 prefix ++ borsh(DelegateAction)): 32 bytes.
  protected async signBytes(hash: Uint8Array): Promise<Uint8Array> {
    const out = await privy<{ data: { signature: string } }>(`/v1/wallets/${this.walletId}/raw_sign`, {
      params: { hash: `0x${Buffer.from(hash).toString("hex")}` },
    });
    return Uint8Array.from(Buffer.from(out.data.signature.replace(/^0x/, ""), "hex"));
  }
}

async function main() {
  // 1. A Privy NEAR wallet. Reuse the one from a previous run so re-runs are cheap.
  let wallet: PrivyWallet;
  if (process.env.SPIKE_PRIVY_NEAR_WALLET_ID) {
    const res = await fetch(`https://api.privy.io/v1/wallets/${process.env.SPIKE_PRIVY_NEAR_WALLET_ID}`, {
      headers: { authorization: privyAuth, "privy-app-id": env("PRIVY_APP_ID") },
    });
    wallet = (await res.json()) as PrivyWallet;
  } else {
    wallet = await privy<PrivyWallet>("/v1/wallets", { chain_type: "near" });
    appendFileSync(ENV_PATH, `SPIKE_PRIVY_NEAR_WALLET_ID=${wallet.id}\n`);
  }
  console.log("privy wallet", { id: wallet.id, chain_type: wallet.chain_type, address: wallet.address, public_key: wallet.public_key });

  // The NEAR address Privy reports is the implicit account id: hex of the ed25519 key.
  const keyBytes = Uint8Array.from(Buffer.from(wallet.address, "hex"));
  if (keyBytes.length !== 32) throw new Error(`Expected a 64-hex implicit address, got ${wallet.address}`);
  const publicKey = new PublicKey({ keyType: 0, data: keyBytes });
  console.log("near public key", publicKey.toString());

  // 2. A named account whose only key is the Privy key. Selkie adds no key of its own.
  const root = new Account(env("NEAR_ROOT_ACCOUNT"), provider, env("NEAR_ROOT_KEY") as `ed25519:${string}`);
  const accountId = `spike-a.${env("NEAR_ROOT_ACCOUNT")}`;
  try {
    await provider.viewAccount({ accountId });
    console.log("exists", accountId);
  } catch {
    const created = await root.createSubAccount({ accountOrPrefix: accountId, publicKey, nearToTransfer: nearToYocto("0.01") });
    console.log("created", accountId, `${EXPLORER}/transactions/${created.transaction.hash}`);
  }
  const keys = await provider.viewAccessKeyList({ accountId });
  console.log(
    "keys on account",
    keys.keys.map((k) => `${k.public_key} ${typeof k.access_key.permission === "string" ? k.access_key.permission : "FunctionCall"}`),
  );

  // 3. Build + sign a delegate action with the Privy key. A harmless call on USDC.
  const user = new Account(accountId, provider, new PrivyRawSigner(wallet.id, publicKey));
  const { delegateHash, signedDelegate } = await user.createSignedMetaTransaction({
    receiverId: env("NEAR_USDC_CONTRACT"),
    actions: [actions.functionCall("ft_balance_of", { account_id: accountId }, 10_000_000_000_000n, 0n)],
    blockHeightTtl: 120,
  });
  const ok = ed25519.verify(signedDelegate.signature.data, delegateHash, keyBytes);
  console.log("signature verifies locally against the Privy public key:", ok);

  // 4. The relayer wraps it and pays the gas.
  const relayer = new Account(env("NEAR_RELAYER_ACCOUNT"), provider, env("NEAR_RELAYER_KEY") as `ed25519:${string}`);
  const result = await relayer.relayMetaTransaction(signedDelegate);
  const status = result.status as Record<string, unknown>;
  console.log("relayed tx", result.transaction.hash, `${EXPLORER}/transactions/${result.transaction.hash}`);
  console.log("outer signer", result.transaction.signer_id, "-> receiver", result.transaction.receiver_id);
  console.log("status", JSON.stringify(status).slice(0, 200));
  for (const r of result.receipts_outcome) {
    console.log("  receipt", r.outcome.executor_id, JSON.stringify(r.outcome.status).slice(0, 120));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
