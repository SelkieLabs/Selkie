"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePrivy, type User as PrivyUser, type WalletWithMetadata } from "@privy-io/react-auth";
import { useCreateWallet, useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { fromHex, signPrepared, toHex } from "@selkie/chain-near/browser";
import { api, type PreparedPayment, type SendResult } from "./api";

/** Privy reports a NEAR wallet's address as the hex of its ed25519 public key. */
function nearWalletOf(user: PrivyUser | null): string | null {
  const wallet = user?.linkedAccounts.find(
    (account): account is WalletWithMetadata => account.type === "wallet" && account.chainType === "near",
  );
  return wallet?.address ?? null;
}

/**
 * The user's own NEAR key: a Privy embedded wallet.
 *
 * Selkie never sees the private key. It reads the public half and asks Privy to
 * sign 32-byte hashes with it, which is all a NEP-366 delegate action needs.
 *
 * `ensure` and `signHash` are stable across renders on purpose: the sign-in
 * effect depends on them, and a function that changed identity when the wallet
 * appeared would start the whole sign-in again.
 */
export function useNearWallet() {
  const { user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();

  const address = nearWalletOf(user);
  const known = useRef(address);
  const creating = useRef<Promise<string> | null>(null);
  useEffect(() => {
    if (address) known.current = address;
  }, [address]);

  /** The wallet's address, creating the wallet the first time. Never twice. */
  const ensure = useCallback(async (): Promise<string> => {
    if (known.current) return known.current;
    creating.current ??= createWallet({ chainType: "near" })
      .then(({ wallet }) => (known.current = wallet.address))
      .finally(() => (creating.current = null));
    return creating.current;
  }, [createWallet]);

  const signHash = useCallback(
    async (hash: Uint8Array): Promise<Uint8Array> => {
      const wallet = await ensure();
      const { signature } = await signRawHash({ address: wallet, chainType: "near", hash: `0x${toHex(hash)}` });
      return fromHex(signature);
    },
    [ensure, signRawHash],
  );

  return { address, ensure, signHash };
}

/**
 * Prepare -> sign -> relay, as one call.
 *
 * The backend says exactly what to sign; the user's key signs it here, in the
 * browser; Selkie's relayer pays the gas and submits. Panels pass how to
 * prepare and get back the same SendResult shape they always showed.
 */
export function useNearPay() {
  const { signHash } = useNearWallet();

  return useCallback(
    async (prepare: () => Promise<PreparedPayment>): Promise<SendResult> => {
      const prepared = await prepare();
      const signedDelegate = await signPrepared(prepared.delegate, signHash);
      return api.near.relay(prepared.prepareId, signedDelegate);
    },
    [signHash],
  );
}
