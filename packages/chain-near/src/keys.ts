/**
 * Access keys: who can sign for an account.
 *
 * This is the whole of the "Selkie holds no key" claim, so it lives in one
 * place that both the API (the proof badge) and `npm run prove:keys` read.
 */
import type { JsonRpcProvider } from "near-api-js";

export interface AccessKeySummary {
  publicKey: string;
  /** "full" or the contract + methods a function-call key is limited to. */
  permission: "full" | { receiverId: string; methodNames: string[] };
}

export async function listAccessKeys(provider: JsonRpcProvider, accountId: string): Promise<AccessKeySummary[]> {
  const list = await provider.viewAccessKeyList({ accountId, finalityQuery: { finality: "final" } });
  return list.keys.map((key) => ({
    publicKey: key.public_key,
    permission:
      key.access_key.permission === "FullAccess" || !("FunctionCall" in key.access_key.permission)
        ? "full"
        : {
            receiverId: key.access_key.permission.FunctionCall.receiver_id,
            methodNames: key.access_key.permission.FunctionCall.method_names,
          },
  }));
}

/**
 * Every account Selkie operates, derived from the root: the root itself and the
 * named children that create accounts, pay gas, release escrow and hold it.
 * Reading their keys from chain gives the full set of keys Selkie could sign
 * with, without trusting Selkie to list them.
 */
export function selkieAccounts(root: string): string[] {
  return [root, ...["x", "relayer", "oracle", "escrow"].map((child) => `${child}.${root}`)];
}
