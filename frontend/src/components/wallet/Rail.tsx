"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/Mark";
import { NEAR_NETWORK, isNear } from "@/lib/chain";
import { MENU_EVENT, TABS, type WalletTab } from "@/lib/tabs";

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
 * On a phone the same panel slides in from the left over half the screen, opened
 * by the burger in the header (MENU_EVENT), and the page shows dimmed beside it.
 */
export function Rail({ active, waiting = 0 }: { active: WalletTab; waiting?: number }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(MENU_EVENT, show);
    return () => window.removeEventListener(MENU_EVENT, show);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = before;
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      {/* Desktop: a panel that stays put while the content scrolls. */}
      <nav
        aria-label="Wallet"
        className="sticky top-24 hidden h-fit w-[14.75rem] shrink-0 flex-col gap-0.5 rounded-[1.375rem] bg-tide-1 p-2.5 shadow-[inset_0_0_0_1px_rgba(233,241,236,0.08)] lg:flex"
      >
        <TabLinks active={active} waiting={waiting} />
        <RailFoot />
      </nav>

      {/* Phone and tablet: the same panel as a drawer over half the screen. */}
      <div className={`fixed inset-0 z-50 lg:hidden ${open ? "" : "pointer-events-none"}`} inert={!open}>
        <button
          aria-label="Close menu"
          tabIndex={-1}
          onClick={close}
          className={`absolute inset-0 bg-abyss/60 backdrop-blur-sm transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
        />
        <nav
          aria-label="Wallet"
          role="dialog"
          aria-modal="true"
          className={`absolute inset-y-0 left-0 flex w-[max(50vw,15.5rem)] max-w-[22rem] flex-col gap-0.5 overflow-y-auto border-r border-pen/[0.08] bg-tide-1 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-[24px_0_60px_rgba(0,0,0,0.45)] transition-transform duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="mb-3 flex items-center justify-between pl-1.5">
            <Wordmark />
            <button onClick={close} aria-label="Close menu" className="grid h-10 w-10 place-items-center rounded-xl text-pen/70 hover:bg-pen/[0.06] hover:text-pen">
              <X size={20} />
            </button>
          </div>
          <TabLinks active={active} waiting={waiting} onPick={close} />
          <div className="mt-auto">
            <RailFoot />
          </div>
        </nav>
      </div>
    </>
  );
}

function TabLinks({ active, waiting, onPick }: { active: WalletTab; waiting: number; onPick?: () => void }) {
  return (
    <>
      {TABS.map((tab) => {
        const on = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={`/wallet/${tab.id}`}
            onClick={onPick}
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
            <span className="truncate">{tab.label}</span>
            {tab.id === "requests" && waiting > 0 && (
              <span className="rail-badge ml-auto" aria-label={`${waiting} waiting on you`}>
                {waiting > 9 ? "9+" : waiting}
              </span>
            )}
          </Link>
        );
      })}
    </>
  );
}

function RailFoot() {
  return (
    <div className="mt-2.5 border-t border-pen/[0.08] px-2.5 pb-1.5 pt-3.5 font-mono text-[11.5px] leading-relaxed text-pen/45">
      <b className="flex items-center gap-2 font-medium text-pen/70">
        <i className="h-[7px] w-[7px] rounded-full bg-sg" />
        {isNear ? `NEAR ${NEAR_NETWORK}` : "Stellar testnet"}
      </b>
      Fees paid by Selkie
    </div>
  );
}
