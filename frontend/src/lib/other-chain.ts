"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type ChainAsset } from "@/lib/api";

/**
 * Other chains through NEAR Intents: what the screens in
 * components/wallet/OtherChain.tsx and CashOutPanel share that is not itself
 * a component.
 */

/** The coins NEAR Intents offers, loaded once `enabled` is true. `live` is false on testnet. */
export function useChainAssets(enabled = true) {
  const [list, setList] = useState<{ live: boolean; assets: ChainAsset[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setList(await api.near.intents.assets());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach NEAR Intents. Try again.");
    }
  }, []);

  useEffect(() => {
    if (enabled && !list) void load();
  }, [enabled, list, load]);

  return { live: list?.live ?? false, assets: list?.assets ?? null, error, reload: load };
}

export const assetName = (asset: ChainAsset) => `${asset.symbol} on ${asset.chainName}`;

const EVM = new Set(["base", "arb", "eth", "bsc", "pol", "op", "avax"]);

/** What an address looks like on each chain, said the way someone would check it. */
function addressShape(asset: ChainAsset): { test: RegExp; hint: string; placeholder: string } {
  if (EVM.has(asset.blockchain)) {
    return { test: /^0x[0-9a-fA-F]{40}$/, hint: "It starts with 0x and is 42 characters long.", placeholder: "0x…" };
  }
  if (asset.blockchain === "tron") {
    return { test: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, hint: "It starts with T and is 34 characters long.", placeholder: "T…" };
  }
  if (asset.blockchain === "sol") {
    return { test: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, hint: "It is 32 to 44 letters and numbers.", placeholder: "Your Solana address" };
  }
  if (asset.blockchain === "ton") {
    return { test: /^(?:[A-Za-z0-9_-]{48}|-?\d:[0-9a-fA-F]{64})$/, hint: "It is 48 characters long.", placeholder: "Your TON address" };
  }
  return { test: /^\S{20,}$/, hint: "Copy it from your wallet rather than typing it.", placeholder: "Your address" };
}

/** Null when the address could be one on that chain. NEAR Intents checks it properly. */
export function chainAddressProblem(asset: ChainAsset, raw: string): string | null {
  const address = raw.trim();
  if (!address) return null;
  const shape = addressShape(asset);
  return shape.test.test(address) ? null : `That doesn't look like an address on ${asset.chainName}. ${shape.hint}`;
}

export const addressPlaceholder = (asset: ChainAsset | null) => (asset ? addressShape(asset).placeholder : "");

/** 0x5aAeb6…1BeAed: enough to recognise an address in a sentence. */
export const shortChainAddress = (address: string) =>
  address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;

/** "about 20 seconds", "about 3 minutes". */
export function inAbout(seconds?: number): string {
  if (!seconds || seconds <= 0) return "A few minutes";
  if (seconds < 90) return `About ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  return `About ${Math.round(seconds / 60)} minutes`;
}
