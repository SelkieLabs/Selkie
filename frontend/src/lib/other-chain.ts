"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type ChainAsset, type IntentsQuote, type IntentsStatus } from "@/lib/api";

/**
 * Other chains through NEAR Intents: what the screens in
 * components/wallet/OtherChain.tsx and the cash-out flow share that is not
 * itself a component.
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

/**
 * A live price for USDC out to another chain.
 *
 * Always a dry quote: nothing is reserved and no deposit address is made. The
 * one that is signed is quoted again on the server at the moment of sending.
 * A price is only returned for the exact inputs it was asked for, so a changed
 * amount or address never shows the old number, and `refreshSeconds` keeps it
 * current on the review screen.
 */
export function useOutQuote(input: {
  asset: ChainAsset | null;
  amount: string;
  address: string;
  active: boolean;
  refreshSeconds?: number;
}) {
  const { asset, amount, active, refreshSeconds = 0 } = input;
  const address = input.address.trim();
  const ready = active && asset !== null && Number(amount) > 0 && address.length > 0 && !chainAddressProblem(asset, address);
  const key = ready && asset ? `${asset.assetId}|${amount}|${address}` : "";

  const [result, setResult] = useState<{ key: string; quote: IntentsQuote | null; error: string | null; at: number }>({
    key: "",
    quote: null,
    error: null,
    at: 0,
  });
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  const run = useCallback(async (forKey: string, forAsset: ChainAsset, forAmount: string, forAddress: string) => {
    const mine = ++latest.current;
    setBusy(true);
    try {
      const quote = await api.near.intents.quote({ direction: "out", assetId: forAsset.assetId, amount: forAmount, address: forAddress });
      if (mine === latest.current) setResult({ key: forKey, quote, error: null, at: Date.now() });
    } catch (err) {
      if (mine !== latest.current) return;
      const error = err instanceof ApiError ? err.message : "Could not get a price just now. Try again.";
      // A failed refresh keeps the last good price for these same inputs.
      setResult((was) => ({ key: forKey, quote: was.key === forKey ? was.quote : null, error, at: was.key === forKey ? was.at : 0 }));
    } finally {
      if (mine === latest.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!key || !asset) return;
    const wait = setTimeout(() => void run(key, asset, amount, address), 450);
    return () => clearTimeout(wait);
  }, [key, asset, amount, address, run]);

  useEffect(() => {
    if (!key || !asset || refreshSeconds <= 0) return;
    const every = setInterval(() => void run(key, asset, amount, address), refreshSeconds * 1000);
    return () => clearInterval(every);
  }, [key, asset, amount, address, refreshSeconds, run]);

  const current = result.key === key && key ? result : null;
  return {
    ready,
    quote: current?.quote ?? null,
    error: current?.error ?? null,
    /** When the price on screen was fetched, to restart the refresh countdown. */
    at: current?.at ?? 0,
    loading: Boolean(key) && (busy || !current),
    retry: () => {
      if (key && asset) void run(key, asset, amount, address);
    },
  };
}

/**
 * Where a move between chains has got to, read from NEAR Intents every few
 * seconds until it is finished one way or the other.
 */
export function useIntentsStatus(depositAddress: string | null) {
  const [status, setStatus] = useState<IntentsStatus | null>(null);
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    if (!depositAddress) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await api.near.intents.status(depositAddress);
        if (!alive) return;
        setStatus(next);
        setProblem(false);
        if (next.done) return;
      } catch {
        if (!alive) return;
        setProblem(true);
      }
      timer = setTimeout(() => void tick(), 6_000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [depositAddress]);

  return { status, problem };
}

export type StageState = "done" | "now" | "next" | "back" | "bad";

/** One line of a progress timeline. `gold` marks money that has arrived for you. */
export interface Stage {
  title: string;
  detail?: string;
  state: StageState;
  gold?: boolean;
}

/**
 * NEAR Intents' status names, as the steps a person would describe. Money out
 * is told from the sender's side; money in from the side of the person waiting
 * for it to land.
 */
export function intentsStages(
  status: IntentsStatus | null,
  direction: "in" | "out",
  asset: { symbol: string; chainName: string },
): Stage[] {
  const name = status?.status ?? "PENDING_DEPOSIT";
  const order = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"];
  const reached = order.indexOf(name);
  const past = (index: number) => reached > index || reached === -1;
  const { symbol, chainName } = asset;

  const ending = (): Stage | null => {
    if (name === "REFUNDED") {
      return direction === "out"
        ? { title: "Back in your Selkie account", detail: "The swap could not finish, so your USDC came back. Nothing was lost.", state: "back" }
        : { title: "Sent back to your refund address", detail: `The swap could not finish, so it went back to your address on ${chainName}.`, state: "back" };
    }
    if (name === "INCOMPLETE_DEPOSIT") {
      return {
        title: direction === "out" ? "Coming back to you" : "Going back to your refund address",
        detail: "Less arrived than the price was for, so NEAR Intents is sending it back.",
        state: "now",
      };
    }
    if (name === "FAILED") {
      return { title: "Did not go through", detail: status?.refundReason ?? "NEAR Intents could not finish it.", state: "bad" };
    }
    return null;
  };

  if (direction === "out") {
    const stages: Stage[] = [
      { title: "Left your account", detail: "Signed by you. Selkie paid the network fee.", state: "done" },
      name === "PENDING_DEPOSIT"
        ? { title: "NEAR Intents picks it up", detail: "Usually within a minute.", state: "now" }
        : name === "KNOWN_DEPOSIT_TX"
          ? { title: "NEAR Intents has it", detail: "Confirming the transfer.", state: "now" }
          : { title: "NEAR Intents has it", state: "done" },
    ];
    const end = ending();
    if (end) return [...stages, end];
    return [
      ...stages,
      name === "PROCESSING"
        ? { title: `Swapping into ${symbol}`, detail: `Then sending it to ${chainName}.`, state: "now" }
        : { title: `Swapped into ${symbol}`, state: past(2) ? "done" : "next" },
      name === "SUCCESS"
        ? {
            title: `Arrived on ${chainName}`,
            detail: status?.amountOutFormatted ? `${status.amountOutFormatted} ${symbol} landed.` : undefined,
            state: "done",
          }
        : { title: `Arrives on ${chainName}`, state: "next" },
    ];
  }

  const stages: Stage[] = [
    name === "PENDING_DEPOSIT"
      ? { title: "Waiting for your deposit", detail: `Send it from your wallet on ${chainName}.`, state: "now" }
      : { title: "Deposit sent", state: "done" },
    name === "KNOWN_DEPOSIT_TX"
      ? { title: "Deposit seen", detail: "Waiting for it to confirm.", state: "now" }
      : { title: "Deposit seen", state: past(1) ? "done" : "next" },
  ];
  const end = ending();
  if (end) return [...stages, end];
  return [
    ...stages,
    name === "PROCESSING"
      ? { title: "Swapping into USDC on NEAR", state: "now" }
      : { title: "Swapped into USDC on NEAR", state: past(2) ? "done" : "next" },
    name === "SUCCESS"
      ? {
          title: "In your account",
          detail: `${status?.amountOutFormatted ?? "Your"} USDC arrived.`,
          state: "done",
          gold: true,
        }
      : { title: "Lands in your account", state: "next" },
  ];
}
