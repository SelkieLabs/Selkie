"use client";

import Link from "next/link";
import { PHONE_TABS, TABS, type WalletTab } from "@/lib/tabs";

/**
 * The rail: where you are, and everywhere else you can go, always visible.
 *
 * On a desktop it is one glass panel rather than a column of loose buttons,
 * which is what makes it read as part of the app instead of five things that
 * happen to be stacked. The selected row is a filled pill: position alone is a
 * weak signal, and every wallet worth copying marks the current place with a
 * shape you can find without reading.
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
        className="sticky top-24 hidden h-fit w-[15.5rem] shrink-0 flex-col gap-1 rounded-[1.35rem] border border-ivory/[0.09] bg-ivory/[0.045] p-2.5 backdrop-blur-2xl lg:flex"
      >
        {TABS.map((tab) => {
          const on = tab.id === active;
          return (
            <Link
              key={tab.id}
              href={`/wallet/${tab.id}`}
              aria-current={on ? "page" : undefined}
              className={`group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-all duration-200 ${
                on
                  ? "bg-gradient-to-r from-gold-light to-gold text-pen shadow-[0_10px_26px_-12px_rgba(217,168,92,0.8)]"
                  : "text-ivory/55 hover:bg-ivory/[0.07] hover:text-ivory"
              }`}
            >
              <span
                className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors ${
                  on ? "bg-pen/[0.12] text-pen" : "bg-ivory/[0.06] text-ivory/70 group-hover:text-ivory"
                }`}
              >
                <tab.icon size={18} strokeWidth={2.2} />
                {tab.id === "requests" && waiting > 0 && (
                  <span className="rail-badge">{waiting > 9 ? "9+" : waiting}</span>
                )}
              </span>
              <span className="text-[14px] font-bold tracking-tight">{tab.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Phone: a bar under the thumb, above everything, in the way of nothing. */}
      <nav
        aria-label="Wallet"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-ivory/[0.08] bg-sea-deep/80 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-2xl lg:hidden"
      >
        <ul className="mx-auto flex max-w-md items-stretch justify-between">
          {PHONE_TABS.map((tab) => {
            const on = tab.id === active;
            return (
              <li key={tab.id} className="flex-1">
                <Link
                  href={`/wallet/${tab.id}`}
                  aria-current={on ? "page" : undefined}
                  className="flex flex-col items-center gap-1 rounded-xl py-1"
                >
                  <span
                    className={`relative grid h-9 w-full max-w-[3.75rem] place-items-center rounded-xl transition-all duration-200 ${
                      on
                        ? "bg-gradient-to-b from-gold-light to-gold-deep text-pen"
                        : "text-ivory/55"
                    }`}
                  >
                    <tab.icon size={18} strokeWidth={2.2} />
                    {tab.id === "requests" && waiting > 0 && (
                      <span className="rail-badge">{waiting > 9 ? "9+" : waiting}</span>
                    )}
                  </span>
                  <span
                    className={`text-[10px] font-bold tracking-tight ${
                      on ? "text-ivory" : "text-ivory/45"
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
