/**
 * Testnet NEAR from the faucet, for the setup scripts.
 *
 * The faucet only creates new accounts, so each top-up makes a throwaway
 * account and deletes it straight into the one that needs the NEAR. Repeats
 * until `accountId` holds at least `min`.
 */
import { Account, KeyPair, actions, type JsonRpcProvider, type KeyPairString } from "near-api-js";

const FAUCET_URL = "https://helper.nearprotocol.com/account";

export async function balanceOf(provider: JsonRpcProvider, accountId: string): Promise<bigint> {
  const view = await provider.viewAccount({ accountId });
  return BigInt(view.amount);
}

/** Returns the hashes of the delete-into transactions, for the log. */
export async function topUpFromFaucet(provider: JsonRpcProvider, accountId: string, min: bigint): Promise<string[]> {
  if (!accountId.endsWith(".testnet")) throw new Error("The faucet is testnet only.");
  const hashes: string[] = [];
  while ((await balanceOf(provider, accountId)) < min) {
    const key = KeyPair.fromRandom("ed25519");
    const temp = `selkie-topup-${Date.now().toString(36)}.testnet`;
    const res = await fetch(FAUCET_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newAccountId: temp, newAccountPublicKey: key.getPublicKey().toString() }),
    });
    if (!res.ok) throw new Error(`Faucet refused ${temp}: ${res.status} ${await res.text()}`);
    for (let i = 0; i < 20; i++) {
      try {
        await balanceOf(provider, temp);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    const funder = new Account(temp, provider, key.toString() as KeyPairString);
    const result = await funder.signAndSendTransaction({
      receiverId: temp,
      actions: [actions.deleteAccount(accountId)],
    });
    hashes.push(result.transaction.hash);
  }
  return hashes;
}
