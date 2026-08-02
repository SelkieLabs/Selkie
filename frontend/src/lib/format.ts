export const ASSETS = ["USDC", "XLM"] as const;
export type Asset = (typeof ASSETS)[number];

/** What each asset is called in the interface. USDC is money, so it reads as money. */
export const ASSET_LABEL: Record<string, string> = {
  USDC: "Dollars",
  XLM: "XLM",
};

/** The dollar asset. Balances, sends and totals default to it. */
export const DOLLAR = "USDC";

/** "$12.50". Only ever used for the asset that actually is dollars. */
export function usd(value: number | string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${money(n)}`;
}

/**
 * Money reads cleanly and never jitters: always two decimals so columns line
 * up, up to eight for small crypto amounts that would round away to nothing.
 */
export function money(value: number | string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  const small = n !== 0 && Math.abs(n) < 1;
  const text = n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: small ? 8 : 2,
  });
  return small ? text.replace(/(\.\d{2}\d*?[1-9])0+$/, "$1") : text;
}

export const normalizeHandle = (handle: string): string =>
  `@${handle.trim().replace(/^@+/, "").toLowerCase()}`;

/**
 * What someone is allowed to type into an amount field: digits, one dot, and at
 * most two decimals. Money is typed by a person, not computed, so the field
 * refuses the impossible rather than correcting it afterwards.
 */
export function cleanAmount(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
  const [whole, decimals] = cleaned.split(".");
  return decimals === undefined ? whole : `${whole}.${decimals.slice(0, 2)}`;
}

/**
 * An address, shortened. It appears in exactly one place, the wallet detail, and
 * only because someone occasionally needs to prove where their money lives.
 */
export function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

export function parseHandles(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((h) => h.replace(/^@+/, "").trim())
        .filter(Boolean),
    ),
  ];
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const units: [number, string][] = [
    [60, "m"],
    [3600, "h"],
    [86400, "d"],
  ];
  if (seconds < 3600) return `${Math.floor(seconds / units[0][0])}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / units[1][0])}h ago`;
  return `${Math.floor(seconds / units[2][0])}d ago`;
}

/**
 * A friendly day bucket for grouping activity: Today, Yesterday, the weekday
 * within the last week, then a plain date (with the year once it's not this
 * one). Compared by calendar day in local time, not by elapsed hours.
 */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Stable calendar-day key (local) for grouping, e.g. "2026-6-24". */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
