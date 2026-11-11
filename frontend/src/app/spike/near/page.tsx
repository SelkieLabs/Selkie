"use client";

/**
 * SPIKE A (throwaway, delete after the spike): can a user's Privy embedded NEAR
 * wallet sign a NEP-366 delegate action that NEAR accepts?
 *
 * 1. sign in with Privy, create (or find) the user's NEAR wallet
 * 2. the local spike relay creates spike-<hex>.selkiepay.testnet with that key as
 *    its ONLY key
 * 3. this page builds the DelegateAction with near-api-js, which hashes it
 *    (sha256 of NEP-461 prefix + borsh) and hands the hash to useSignRawHash
 * 4. the relay submits it with the relayer's key and pays the gas
 *
 * Imports near-api-js directly, which product code must not do (only
 * @selkie/chain-near may). Fine for a page that exists to be deleted.
 */
import { useState } from "react";
import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth";
import { useCreateWallet, useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { Account, JsonRpcProvider, PublicKey, Signer, actions, encodeSignedDelegate } from "near-api-js";

const RELAY = "http://localhost:4600";
const RPC = "https://test.rpc.fastnear.com";
const USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.replace(/^0x/, "").match(/../g)!.map((h) => parseInt(h, 16)));

export default function NearSpike() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const say = (line: string) => setLog((l) => [...l, line]);

  async function run() {
    setBusy(true);
    setLog([]);
    try {
      // 1. The user's NEAR wallet. Its address is the implicit account id = hex(ed25519 key).
      let wallet = user?.linkedAccounts.find(
        (a): a is WalletWithMetadata => a.type === "wallet" && a.chainType === "near",
      );
      let address = wallet?.address;
      if (!address) {
        say("no NEAR wallet yet, creating one…");
        const created = await createWallet({ chainType: "near" });
        address = created.wallet.address;
        say(`created wallet: ${JSON.stringify(created.wallet).slice(0, 300)}`);
      }
      say(`privy NEAR address (implicit id): ${address}`);
      const keyBytes = unhex(address);
      const publicKey = new PublicKey({ keyType: 0, data: keyBytes });
      say(`public key: ${publicKey.toString()}`);

      // 2. A named account whose only key is that one.
      const acct = await post<{ accountId: string; createTx: string | null; keys: string[] }>("/account", {
        publicKeyHex: hex(keyBytes),
      });
      say(`account ${acct.accountId}${acct.createTx ? ` (created, tx ${acct.createTx})` : " (exists)"}`);
      say(`keys on account: ${acct.keys.join(", ")}`);

      // 3. Build + sign the delegate action in the browser.
      const signer = new (class extends Signer {
        async getPublicKey() {
          return publicKey;
        }
        protected async signBytes(hash: Uint8Array) {
          say(`signing hash 0x${hex(hash)} with Privy useSignRawHash…`);
          const { signature } = await signRawHash({ address: address!, chainType: "near", hash: `0x${hex(hash)}` });
          return unhex(signature);
        }
      })();
      const account = new Account(acct.accountId, new JsonRpcProvider({ url: RPC }), signer);
      const { signedDelegate } = await account.createSignedMetaTransaction({
        receiverId: USDC,
        actions: [actions.functionCall("ft_balance_of", { account_id: acct.accountId }, 10_000_000_000_000n, 0n)],
        blockHeightTtl: 120,
      });
      const b64 = btoa(String.fromCharCode(...encodeSignedDelegate(signedDelegate)));
      say(`signed delegate (${b64.length} b64 chars), relaying…`);

      // 4. Relay.
      const out = await post<{ txHash: string; explorer: string; status: unknown; receipts: unknown[] }>("/relay", {
        signedDelegate: b64,
      });
      say(`relayed: ${out.explorer}`);
      say(`status: ${JSON.stringify(out.status)}`);
      say(`receipts: ${JSON.stringify(out.receipts)}`);
      say("PASS");
    } catch (err) {
      say(`FAIL: ${err instanceof Error ? `${err.message}\n${err.stack}` : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "ui-monospace, monospace", fontSize: 13, maxWidth: 900 }}>
      <h1 style={{ fontSize: 18, marginBottom: 12 }}>Spike A: Privy NEAR wallet signs a delegate action</h1>
      {!ready ? (
        <p>loading Privy…</p>
      ) : !authenticated ? (
        <button onClick={login} style={btn}>Sign in</button>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={run} disabled={busy} style={btn}>{busy ? "running…" : "Run spike"}</button>
          <button onClick={logout} style={btn}>Sign out</button>
        </div>
      )}
      <pre style={{ whiteSpace: "pre-wrap", marginTop: 16, lineHeight: 1.6 }}>{log.join("\n")}</pre>
    </main>
  );
}

const btn = { padding: "8px 14px", border: "1px solid #888", borderRadius: 6, background: "transparent", color: "inherit" };

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${RELAY}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error ?? res.statusText);
  return out as T;
}
