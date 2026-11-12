"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type BankInstitution, type BankQuote, type BankStatus } from "@/lib/api";
import type { Stage } from "@/lib/other-chain";

/**
 * Cash out to a bank through Paycrest: what the cash-out screens share that
 * is not itself a component. Banks, rates and the name check come from the
 * server, which asks Paycrest; nothing here holds a key.
 */

/** The currencies Paycrest pays out in for Selkie, naira first. */
export const BANK_CURRENCIES = [
  { code: "NGN", country: "Nigeria", flag: "/flags/ng.svg", symbol: "₦", name: "Naira" },
  { code: "KES", country: "Kenya", flag: "/flags/ke.svg", symbol: "KSh ", name: "Kenyan shilling" },
  { code: "UGX", country: "Uganda", flag: "/flags/ug.svg", symbol: "USh ", name: "Ugandan shilling" },
  { code: "TZS", country: "Tanzania", flag: "/flags/tz.svg", symbol: "TSh ", name: "Tanzanian shilling" },
] as const;

export type BankCurrency = (typeof BANK_CURRENCIES)[number]["code"];

export const currencyOf = (code: string) => BANK_CURRENCIES.find((entry) => entry.code === code) ?? BANK_CURRENCIES[0];

/** "₦13,980.50": grouped by hand from the decimal string, so no float ever touches it. */
export function fiat(amount: string, code: string): string {
  const [whole = "0", decimals = ""] = amount.split(".");
  const grouped = whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = `${decimals}00`.slice(0, 2);
  return `${currencyOf(code).symbol}${grouped}.${cents}`;
}

/** Why a bank quote is only a preview, in a few words for a footer. */
export const previewLabel = (quote: BankQuote): string =>
  quote.live ? "Preview: bank payouts aren't switched on yet" : "Preview: sending works on mainnet";

export const lastFour = (accountNumber: string) => accountNumber.replace(/\D/g, "").slice(-4);

/** "Guaranty Trust Bank ••6789": enough to recognise the account, never the whole number. */
export const bankLine = (bankName: string, accountNumber: string) => `${bankName} ••${lastFour(accountNumber)}`;

/** Nigerian accounts are ten digits (NUBAN); elsewhere, a phone number or account of six or more. */
export const accountLength = (code: string) => (code === "NGN" ? 10 : 6);

/** The banks (and mobile-money services) Paycrest pays into for a currency, A to Z. */
export function useBanks(currency: string | null) {
  const [lists, setLists] = useState<Record<string, BankInstitution[]>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (code: string) => {
    setError(null);
    try {
      const { institutions } = await api.near.bank.institutions(code);
      const sorted = [...institutions].sort((a, b) => a.name.localeCompare(b.name));
      setLists((was) => ({ ...was, [code]: sorted }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the banks. Try again.");
    }
  }, []);

  useEffect(() => {
    if (currency && !lists[currency]) void load(currency);
  }, [currency, lists, load]);

  return {
    institutions: currency ? (lists[currency] ?? null) : null,
    error,
    reload: () => {
      if (currency) void load(currency);
    },
  };
}

/**
 * The name the bank has on an account, looked up as the number is typed.
 * `name` is null when the bank answers but does not share names (some mobile
 * money), and the person types it instead.
 */
export function useAccountName(input: { currency: string; institution: string; accountNumber: string; active: boolean }) {
  const digits = input.accountNumber.replace(/\D/g, "");
  const ready = input.active && input.institution.length > 0 && digits.length >= accountLength(input.currency);
  const key = ready ? `${input.currency}|${input.institution}|${digits}` : "";
  const [result, setResult] = useState<{ key: string; name: string | null; problem: string | null } | null>(null);
  const [checking, setChecking] = useState(false);
  const latest = useRef(0);

  const run = useCallback(async (forKey: string, currency: string, institution: string, account: string) => {
    const mine = ++latest.current;
    setChecking(true);
    try {
      const found = await api.near.bank.verify({ currency, institution, accountIdentifier: account });
      if (mine === latest.current) setResult({ key: forKey, name: found.accountName, problem: null });
    } catch (err) {
      if (mine !== latest.current) return;
      const problem =
        err instanceof ApiError && err.status === 400
          ? `${err.message}. Check the number and the bank.`
          : err instanceof ApiError
            ? err.message
            : "Could not check the account just now. Try again.";
      setResult({ key: forKey, name: null, problem });
    } finally {
      if (mine === latest.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!key) return;
    const wait = setTimeout(() => void run(key, input.currency, input.institution, digits), 500);
    return () => clearTimeout(wait);
  }, [key, input.currency, input.institution, digits, run]);

  const current = result && result.key === key && key ? result : null;
  return {
    ready,
    /** The answer belongs to what is typed now. */
    checked: current !== null,
    checking: Boolean(key) && (checking || !current),
    name: current?.name ?? null,
    problem: current?.problem ?? null,
    retry: () => {
      if (key) void run(key, input.currency, input.institution, digits);
    },
  };
}

/**
 * The rate and what a bank cash-out would cost to send, kept current. Only
 * for the exact currency and amount it was asked for, so a changed amount
 * never shows the old number.
 */
export function useBankQuote(input: { currency: string; amount: string; active: boolean; refreshSeconds?: number }) {
  const { currency, amount, active, refreshSeconds = 0 } = input;
  const key = active && currency && Number(amount) > 0 ? `${currency}|${amount}` : "";
  const [result, setResult] = useState<{ key: string; quote: BankQuote | null; error: string | null; at: number }>({
    key: "",
    quote: null,
    error: null,
    at: 0,
  });
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  const run = useCallback(async (forKey: string, forCurrency: string, forAmount: string) => {
    const mine = ++latest.current;
    setBusy(true);
    try {
      const quote = await api.near.bank.quote({ currency: forCurrency, amount: forAmount });
      if (mine === latest.current) setResult({ key: forKey, quote, error: null, at: Date.now() });
    } catch (err) {
      if (mine !== latest.current) return;
      const error = err instanceof ApiError ? err.message : "Could not get a rate just now. Try again.";
      setResult((was) => ({ key: forKey, quote: was.key === forKey ? was.quote : null, error, at: was.key === forKey ? was.at : 0 }));
    } finally {
      if (mine === latest.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!key) return;
    const wait = setTimeout(() => void run(key, currency, amount), 350);
    return () => clearTimeout(wait);
  }, [key, currency, amount, run]);

  useEffect(() => {
    if (!key || refreshSeconds <= 0) return;
    const every = setInterval(() => void run(key, currency, amount), refreshSeconds * 1000);
    return () => clearInterval(every);
  }, [key, currency, amount, refreshSeconds, run]);

  const current = result.key === key && key ? result : null;
  return {
    quote: current?.quote ?? null,
    error: current?.error ?? null,
    at: current?.at ?? 0,
    loading: Boolean(key) && (busy || !current),
    retry: () => {
      if (key) void run(key, currency, amount);
    },
  };
}

/** Where a bank cash-out has got to, every few seconds until it is finished one way or the other. */
export function useBankStatus(orderId: string | null, depositAddress: string | null) {
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    if (!orderId || !depositAddress) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await api.near.bank.status(orderId, depositAddress);
        if (!alive) return;
        setStatus(next);
        setProblem(false);
        if (next.done) return;
      } catch {
        if (!alive) return;
        setProblem(true);
      }
      timer = setTimeout(() => void tick(), 5_000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [orderId, depositAddress]);

  return { status, problem };
}

/**
 * Both halves of a bank cash-out as the steps a person would describe: the
 * swap to USDC on Base, then Paycrest paying the bank, ending in the amount
 * and the account it reached.
 */
export function bankStages(
  status: BankStatus | null,
  to: { fiatAmount: string; currency: string; institutionName: string; accountLast4: string },
): Stage[] {
  const stage = status?.stage ?? "swapping";
  const where = `${to.institutionName} ••${to.accountLast4}`;
  const amount = fiat(to.fiatAmount, to.currency);
  const left: Stage = { title: "Left your account", detail: "Signed by you. Selkie paid the network fee.", state: "done" };
  const swapped: Stage = { title: "Swapped to USDC on Base", detail: "NEAR Intents delivered it to Paycrest.", state: "done" };

  switch (stage) {
    case "swapping":
      return [
        left,
        { title: "Swapping to USDC on Base", detail: "NEAR Intents moves it to Paycrest. Usually under a minute.", state: "now" },
        { title: `Paycrest pays ${to.institutionName}`, state: "next" },
        { title: `Arrives in ${where}`, state: "next" },
      ];
    case "paying":
      return [
        left,
        swapped,
        { title: `Paycrest is paying ${to.institutionName}`, detail: "Most payouts land within a minute.", state: "now" },
        { title: `Arrives in ${where}`, state: "next" },
      ];
    case "paid":
      return [
        left,
        swapped,
        { title: `Paycrest paid ${to.institutionName}`, state: "done" },
        { title: `${amount} sent to ${where}`, detail: "It's in the account. Banks can take a few minutes to show it.", state: "done", gold: true },
      ];
    case "back-to-you":
      return [
        left,
        {
          title: "Back in your Selkie account",
          detail: status?.intents?.refundReason ?? "The swap could not finish, so your USDC came back. Nothing was lost.",
          state: "back",
        },
      ];
    case "returning":
      return [
        left,
        swapped,
        {
          title: "Paycrest could not pay the bank",
          detail: "It is sending the USDC back to Selkie, and Selkie returns it to your account.",
          state: "now",
        },
      ];
    case "returned":
      return [
        left,
        swapped,
        { title: "Paycrest sent it back", detail: "The USDC went back to Selkie, which returns it to your account.", state: "back" },
      ];
    case "expired":
      return [
        left,
        { title: "The payout ran out of time", detail: "Paycrest never received the money, so nothing reached the bank.", state: "bad" },
      ];
    case "late":
      return [
        left,
        swapped,
        {
          title: "It arrived as the payout ran out",
          detail: "Paycrest's order had just closed. Selkie is sorting it out with Paycrest.",
          state: "bad",
        },
      ];
  }
}
