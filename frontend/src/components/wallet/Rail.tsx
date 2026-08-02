"use client";

import Link from "next/link";
import { TABS, type WalletTab } from "@/lib/tabs";

/**
 * The rail: where you are, and everywhere else you can go, always visible.
 *
 * It sits beside the content on a desktop and along the bottom on a phone,
 * because a thumb reaches the bottom of a screen and not the left edge of one.
 * The badge is the point of having it: how many people are waiting on you,
 * readable without opening anything.
 */
export function Rail({ active, waiting = 0 }: { active: WalletTab; waiting?: number }) {
  return (
    <>
      {/* Desktop: a column that stays put while the content scrolls. */}
      <nav
        aria-label="Wallet"
        className="sticky top-24 hidden shrink-0 flex-col gap-3 lg:flex"
      >
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            href={`/wallet/${tab.id}`}
            aria-current={tab.id === active ? "page" : undefined}
            className="group flex items-center gap-3"
          >
            <span className={`rail-sq ${tab.id === active ? "rail-on" : ""}`}>
              <tab.icon size={19} strokeWidth={2.2} />
              {tab.id === "requests" && waiting > 0 && (
                <span className="rail-badge">{waiting > 9 ? "9+" : waiting}</span>
              )}
            </span>
            <span
              className={`text-[14px] font-bold tracking-tight transition-colors ${
                tab.id === active ? "text-ivory" : "text-ivory/45 group-hover:text-ivory/80"
              }`}
            >
              {tab.label}
            </span>
          </Link>
        ))}
      </nav>

      {/* Phone: a bar under the thumb, above everything, out of the way of nothing. */}
      <nav
        aria-label="Wallet"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-ivory/[0.08] bg-sea-deep/85 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden"
      >
        <ul className="mx-auto flex max-w-md items-stretch justify-between">
          {TABS.map((tab) => (
            <li key={tab.id} className="flex-1">
              <Link
                href={`/wallet/${tab.id}`}
                aria-current={tab.id === active ? "page" : undefined}
                className="flex flex-col items-center gap-1 rounded-xl py-1.5"
              >
                <span className="relative grid h-9 w-9 place-items-center">
                  <span
                    className={`grid h-9 w-9 place-items-center rounded-xl transition-colors ${
                      tab.id === active
                        ? "bg-gradient-to-b from-gold-light to-gold-deep text-pen"
                        : "text-ivory/55"
                    }`}
                  >
                    <tab.icon size={18} strokeWidth={2.2} />
                  </span>
                  {tab.id === "requests" && waiting > 0 && (
                    <span className="rail-badge">{waiting > 9 ? "9+" : waiting}</span>
                  )}
                </span>
                <span
                  className={`text-[10px] font-bold tracking-tight ${
                    tab.id === active ? "text-ivory" : "text-ivory/45"
                  }`}
                >
                  {tab.label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
