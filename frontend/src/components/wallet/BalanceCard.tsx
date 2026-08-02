"use client";

import { Repeat } from "lucide-react";
import { TokenIcon } from "@/components/TokenIcon";
import type { Money } from "@/lib/api";
import { DOLLAR, money, usd } from "@/lib/format";

/**
 * What you have, at the top of every screen.
 *
 * Dollars get the big number because dollars are what people think in. Anything
 * else is a quiet row underneath with its own logo, which is enough to be found
 * and not enough to compete.
 */
export function BalanceCard({
  balances,
  loading,
  onConvert,
}: {
  balances: Money[];
  loading: boolean;
  onConvert: () => void;
}) {
  const dollars = balances.find((balance) => balance.asset === DOLLAR)?.amount ?? "0";
  const others = balances.filter((balance) => balance.asset !== DOLLAR);
  const hasSomethingToConvert = balances.some((balance) => Number(balance.amount) > 0);

  return (
    <section className="chunk-gold p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Your balance</p>
          {loading ? (
            <span className="mt-3 block h-11 w-40 animate-pulse rounded-lg bg-pen/[0.12]" />
          ) : (
            <p className="mt-2 font-display text-[2.75rem] font-bold leading-none tracking-tight sm:text-[3.25rem]">
              {usd(dollars)}
            </p>
          )}
        </div>
        <button
          onClick={onConvert}
          disabled={!hasSomethingToConvert}
          className="btn btn-dark btn-sm shrink-0"
        >
          <Repeat size={15} strokeWidth={2.4} /> Convert
        </button>
      </div>

      {others.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {others.map((balance) => (
            <span
              key={balance.asset}
              className="flex items-center gap-2 rounded-full border-2 border-pen/15 bg-card-bright/70 py-1 pl-1 pr-3"
            >
              <TokenIcon asset={balance.asset} size={22} />
              <span className="font-display text-[13px] font-bold tabular-nums">
                {money(balance.amount)} {balance.asset}
              </span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
