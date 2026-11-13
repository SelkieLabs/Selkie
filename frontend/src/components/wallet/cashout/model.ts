/**
 * What the cash-out flow shares that is not a component: its steps, the
 * countries a bank can be in, and cent arithmetic for the amount buttons.
 */

/** "chain" is NEAR Intents: USDC out to another chain. */
export type Destination = "bank" | "wallet" | "chain";
/** "bills" is the airtime, data and bills preview: beside the flow, like "soon". */
export type Step = "where" | "amount" | "details" | "review" | "soon" | "bills" | "done";

/** The four steps the indicator shows. "done", "soon" and "bills" sit outside the flow. */
export const FLOW = [
  { step: "where", label: "Where to" },
  { step: "amount", label: "Amount" },
  { step: "details", label: "Details" },
  { step: "review", label: "Review" },
] as const satisfies ReadonlyArray<{ step: Step; label: string }>;

export const flowIndex = (step: Step): number => FLOW.findIndex((entry) => entry.step === step);

/** Where someone's bank is. Shapes the fields, and later the provider. */
export const COUNTRIES = [
  { code: "NG", label: "Nigeria", currency: "NGN" },
  { code: "GH", label: "Ghana", currency: "GHS" },
  { code: "KE", label: "Kenya", currency: "KES" },
  { code: "ZA", label: "South Africa", currency: "ZAR" },
  { code: "US", label: "United States", currency: "USD" },
  { code: "GB", label: "United Kingdom", currency: "GBP" },
] as const;

export type Country = (typeof COUNTRIES)[number];

/** The marks on the "Another chain" choice: the chains people ask for most. */
export const CHAIN_PREVIEW = [
  { blockchain: "base", name: "Base" },
  { blockchain: "tron", name: "Tron" },
  { blockchain: "sol", name: "Solana" },
];

/**
 * A decimal string as whole cents, cut rather than rounded. Rounding 0.297 up
 * to 0.30 would offer a "Max" one cent bigger than the balance, and the send
 * would fail for a reason nobody could see.
 */
export function toCents(value: string): number {
  const [whole = "", decimals = ""] = value.trim().split(".");
  const units = Number(whole.replace(/\D/g, "") || "0");
  const cents = Number(`${decimals.replace(/\D/g, "")}00`.slice(0, 2));
  return units * 100 + cents;
}

export const fromCents = (cents: number): string =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

/** A share of the balance, rounded down to the cent so it is never more than there is. */
export const portionOf = (balance: string, share: number): string =>
  fromCents(Math.floor(toCents(balance) * share));

/** Is this amount one that can go out? Checked as it is typed, in cents, never floats. */
export function checkAmount(amount: string, balance: string): { ok: boolean; problem: string | null; left: string | null } {
  const have = toCents(balance);
  const want = toCents(amount);
  if (have <= 0) return { ok: false, problem: "You have nothing to cash out yet.", left: null };
  if (!amount.trim() || want === 0) return { ok: false, problem: null, left: null };
  if (want > have) {
    return { ok: false, problem: `That's more than you have. You can take out up to ${fromCents(have)} USDC.`, left: null };
  }
  return { ok: true, problem: null, left: fromCents(have - want) };
}

/** The bank fields, kept together so going back and forth never loses them. */
export interface BankDetails {
  /** Stellar's form: where the bank is. */
  country: string;
  /** The bank's name, as typed (Stellar) or as Paycrest lists it (NEAR). */
  bank: string;
  accountNumber: string;
  /** NEAR: typed only when the bank does not share the name on the account. */
  accountName: string;
  /** NEAR: the currency Paycrest pays out in. */
  currency: string;
  /** NEAR: the bank's Paycrest code (GTBINGLA, ...). */
  institution: string;
}

export const EMPTY_BANK: BankDetails = {
  country: COUNTRIES[0].code,
  bank: "",
  accountNumber: "",
  accountName: "",
  currency: "NGN",
  institution: "",
};

export const bankReady = (details: BankDetails): boolean =>
  details.bank.trim().length > 0 && details.accountNumber.trim().length > 0 && details.accountName.trim().length > 0;
