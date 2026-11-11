/**
 * Spike A, part 2 (server side): a tiny local relay for the /spike/near page.
 *
 *   POST /account { publicKeyHex }   create spike-<8 hex>.<root> whose ONLY key is
 *                                    the user's Privy NEAR key (mirrors design 5.1)
 *   POST /relay   { signedDelegate } base64 borsh SignedDelegate -> relayer submits
 *
 * Keys stay here, in this process; the page never sees one. Listens on localhost
 * only and only answers the local web app's origin. Throwaway, not product code.
 *
 *   npx tsx --env-file=.env packages/chain-near/spikes/spike-a-relay.ts
 */
import { createServer } from "node:http";
import { deserialize } from "borsh";
import { Account, JsonRpcProvider, PublicKey, SCHEMA, nearToYocto } from "near-api-js";

const PORT = 4600;
const ORIGIN = "http://localhost:3000";
const EXPLORER = "https://explorer.testnet.near.org";
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} missing from .env`);
  return v;
};

const provider = new JsonRpcProvider({ url: env("NEAR_RPC_URL") });
const root = new Account(env("NEAR_ROOT_ACCOUNT"), provider, env("NEAR_ROOT_KEY") as `ed25519:${string}`);
const relayer = new Account(env("NEAR_RELAYER_ACCOUNT"), provider, env("NEAR_RELAYER_KEY") as `ed25519:${string}`);

async function createAccount(publicKeyHex: string) {
  if (!/^[0-9a-f]{64}$/.test(publicKeyHex)) throw new Error("publicKeyHex must be 64 lowercase hex chars");
  const publicKey = new PublicKey({ keyType: 0, data: Uint8Array.from(Buffer.from(publicKeyHex, "hex")) });
  const accountId = `spike-${publicKeyHex.slice(0, 8)}.${env("NEAR_ROOT_ACCOUNT")}`;
  let createTx: string | null = null;
  try {
    await provider.viewAccount({ accountId });
  } catch {
    const res = await root.createSubAccount({ accountOrPrefix: accountId, publicKey, nearToTransfer: nearToYocto("0.01") });
    createTx = res.transaction.hash;
  }
  const keys = await provider.viewAccessKeyList({ accountId });
  return { accountId, publicKey: publicKey.toString(), createTx, keys: keys.keys.map((k) => k.public_key) };
}

async function relay(signedDelegateB64: string) {
  const signedDelegate = deserialize(SCHEMA.SignedDelegate, Buffer.from(signedDelegateB64, "base64")) as never;
  const sd = signedDelegate as { delegateAction: { senderId: string; receiverId: string } };
  console.log("relaying for", sd.delegateAction.senderId, "->", sd.delegateAction.receiverId);
  const result = await relayer.relayMetaTransaction(signedDelegate);
  return {
    txHash: result.transaction.hash,
    explorer: `${EXPLORER}/transactions/${result.transaction.hash}`,
    status: result.status,
    receipts: result.receipts_outcome.map((r) => ({ executor: r.outcome.executor_id, status: r.outcome.status })),
  };
}

createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", ORIGIN);
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method !== "POST") return res.writeHead(405).end();
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const input = JSON.parse(body) as Record<string, string>;
    const out =
      req.url === "/account" ? await createAccount(input.publicKeyHex ?? "")
      : req.url === "/relay" ? await relay(input.signedDelegate ?? "")
      : null;
    if (!out) return res.writeHead(404).end();
    console.log(req.url, JSON.stringify(out).slice(0, 300));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  } catch (err) {
    console.error(req.url, err);
    res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(err) }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`spike relay on http://localhost:${PORT}`));
