"use client";

import Link from "next/link";
import { NEAR_NETWORK, isNear } from "@/lib/chain";
import { PHONE_TABS, TABS, type WalletTab } from "@/lib/tabs";

/**
 * The rail: where you are, and everywhere else you can go, always visible.
 *
 * On a desktop it is one ink panel rather than a column of loose buttons, which
 * is what makes it read as part of the app instead of seven things that happen
 * to be stacked. The current place is filled with foam: position alone is a
 * weak signal, and a shape you can find without reading is a strong one. The
 * foot says where the money is and who pays the fees, because on a chain those
 * are the two things people wonder about.
 *
 * On a phone it sits along the bottom, because a thumb reaches the bottom of a
 * screen and not the left edge of one.
 */
export function Rail({ active, waiting = 0 }: { active: WalletTab; waiting?: number }) {
  return (
    <>
      {/* Desktop: a panel that stays put while the content scrolls. */}
      <nav
        aria-label="Wallet"
        className="sticky top-24 hidden h-fit w-[14.75rem] shrink-0 flex-col gap-0.5 rounded-[1.375rem] bg-tide-1 p-2.5 shadow-[inset_0_0_0_1px_rgba(233,241,236,0.08)] lg:flex"
      >
        {TABS.map((tab) => {
          const on = tab.id === active;
          return (
            <Link
              key={tab.id}
              href={`/wallet/${tab.id}`}
              aria-current={on ? "page" : undefined}
              className={`group flex items-center gap-3 rounded-[0.875rem] px-2.5 py-2 text-[14.5px] font-semibold transition-colors duration-150 ${
                on ? "bg-foam text-abyss" : "text-pen/70 hover:bg-pen/[0.05] hover:text-pen"
              }`}
            >
              <span
                className={`grid h-[2.125rem] w-[2.125rem] shrink-0 place-items-center rounded-[0.7rem] transition-colors duration-150 ${
                  on ? "bg-abyss/10 text-abyss" : "bg-tide-2 text-pen/70 group-hover:text-pen"
                }`}
              >
                <tab.icon size={17} strokeWidth={2} />
              </span>
              {tab.label}
              {tab.id === "requests" && waiting > 0 && (
                <span className="rail-badge ml-auto" aria-label={`${waiting} waiting on you`}>
                  {waiting > 9 ? "9+" : waiting}
                </span>
              )}
            </Link>
          );
        })}
        <div className="mt-2.5 border-t border-pen/[0.08] px-2.5 pb-1.5 pt-3.5 font-mono text-[11.5px] leading-relaxed text-pen/45">
          <b className="flex items-center gap-2 font-medium text-pen/70">
            <i className="h-[7px] w-[7px] rounded-full bg-sg" />
            {isNear ? `NEAR ${NEAR_NETWORK}` : "Stellar testnet"}
          </b>
          Fees paid by Selkie
        </div>
      </nav>

      {/* Phone: a bar under the thumb, above everything, in the way of nothing. */}
      <nav
        aria-label="Wallet"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-pen/[0.08] bg-tide-0/85 px-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl lg:hidden"
      >
        <ul className="mx-auto flex max-w-md items-stretch justify-between">
          {PHONE_TABS.map((tab) => {
            const on = tab.id === active;
            return (
              <li key={tab.id} className="min-w-0 flex-1">
                <Link
                  href={`/wallet/${tab.id}`}
                  aria-current={on ? "page" : undefined}
                  className="flex flex-col items-center gap-1 rounded-xl py-1"
                >
                  <span
                    className={`relative grid h-8 w-full max-w-[3.5rem] place-items-center rounded-[0.7rem] transition-colors duration-150 ${
                      on ? "bg-foam text-abyss" : "text-pen/55"
                    }`}
                  >
                    <tab.icon size={18} strokeWidth={2} />
                    {tab.id === "requests" && waiting > 0 && (
                      <span className="absolute -right-0.5 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-sg px-1 font-mono text-[10px] font-semibold text-abyss">
                        {waiting > 9 ? "9+" : waiting}
                      </span>
                    )}
                  </span>
                  <span
                    className={`max-w-full truncate text-[10.5px] font-medium ${
                      on ? "text-pen" : "text-pen/50"
                    }`}
                  >
                    {tab.short}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
