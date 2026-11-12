"use client";

import { useRef } from "react";
import { ArrowRight } from "lucide-react";
import { isNear } from "@/lib/chain";
import { cleanAmount, money } from "@/lib/format";
import { Head } from "./bits";
import { checkAmount, portionOf, toCents, type Destination } from "./model";

const BLURB: Record<Destination, string> = {
  wallet: "Straight to a NEAR account. It arrives in seconds and there is no fee.",
  chain: "NEAR Intents swaps your USDC and sends it on. You see the price before anything moves.",
  bank: "Paid into your bank in your own currency.",
};

/** Portions rather than round numbers: cashing out is usually "most of it" or "all of it". */
const SHARES = [
  ["25%", 0.25],
  ["Half", 0.5],
  ["Max", 1],
] as const;

export function AmountStep({
  destination,
  amount,
  onAmount,
  balance,
  onContinue,
}: {
  destination: Destination;
  amount: string;
  onAmount: (amount: string) => void;
  balance: string;
  onContinue: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const check = checkAmount(amount, balance);
  const empty = toCents(balance) <= 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (check.ok) onContinue();
      }}
    >
      <Head
        title="How much?"
        blurb={
          destination === "wallet" && !isNear
            ? "Straight to your wallet, nothing in between."
            : destination === "bank" && isNear
              ? "In USDC. Next you pick the currency and your bank, and see what arrives at today's rate."
              : BLURB[destination]
        }
      />

      <label className="co-label mt-6" htmlFor="cashout-amount">
        Amount in USDC
      </label>
      <div
        className="co-field co-amount mt-2"
        aria-invalid={check.problem ? true : undefined}
        onClick={() => input.current?.focus()}
      >
        <span className="co-cur" aria-hidden="true">
          $
        </span>
        <input
          ref={input}
          id="cashout-amount"
          placeholder="0.00"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          value={amount}
          onChange={(e) => onAmount(cleanAmount(e.target.value))}
          aria-describedby="cashout-amount-note"
        />
        <span className="co-unit">USDC</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="co-chips">
          {SHARES.map(([label, share]) => {
            const value = portionOf(balance, share);
            return (
              <button
                key={label}
                type="button"
                className="co-chip"
                disabled={empty}
                aria-pressed={!empty && toCents(amount) === toCents(value) && amount !== ""}
                onClick={() => onAmount(value)}
              >
                {label}
              </button>
            );
          })}
        </div>
        <span className="co-hint ml-auto">
          <span className="co-mono">{money(balance)}</span> available
        </span>
      </div>

      <p id="cashout-amount-note" className="mt-3 min-h-[1.5rem]" aria-live="polite">
        {check.problem ? (
          <span className="co-error">{check.problem}</span>
        ) : check.left !== null ? (
          <span className="co-hint">
            Leaves <span className="co-mono text-[#e9f1ee]">{money(check.left)}</span> USDC in your account.
          </span>
        ) : null}
      </p>

      <button type="submit" className="co-btn mt-5" disabled={!check.ok}>
        Continue <ArrowRight size={16} strokeWidth={2.4} />
      </button>
    </form>
  );
}

