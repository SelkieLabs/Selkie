"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { HandleSuggestions } from "@/components/wallet/HandleSuggestions";
import type { ActivityEntry } from "@/lib/api";
import { isNear } from "@/lib/chain";
import { cleanAmount, money } from "@/lib/format";
import { savePayLink } from "@/lib/pay-link";
import { MASK, useAmountsHidden } from "@/lib/privacy";
import { useHandleSuggestBox } from "@/lib/useHandleSuggestions";

const HANDLE = /^[a-z0-9_]{1,15}$/;

/**
 * Send, from Home, without leaving it.
 *
 * Only the two questions that matter (who, how much). "Review" hands them to
 * the Send tab's own check screen, the same one every payment goes through,
 * so there is one place money is confirmed and signed, not two.
 */
export function QuickSend({ balance }: { balance: string }) {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [amount, setAmount] = useState("");
  const clean = handle.trim().replace(/^@+/, "").toLowerCase();
  const value = Number(amount);
  const tooMuch = value > Number(balance);
  const ready = HANDLE.test(clean) && value > 0 && !tooMuch;

  const suggest = useHandleSuggestBox({
    id: "quick-suggestions",
    text: clean,
    enabled: isNear,
    onPick: (username) => {
      setHandle(username);
      suggest.close();
      document.getElementById("quick-amount")?.focus();
    },
  });

  const review = () => {
    if (!ready) return;
    savePayLink({ kind: "pay", handle: clean, amount, note: "" });
    router.push("/wallet/send?review=1");
  };

  return (
    <section className="chunk p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[21px] font-extrabold tracking-[-0.02em]">Send</h2>
        <span className="text-[13px] text-pen/45">to any X handle</span>
      </div>

      <label className="label mb-1.5 mt-3 block" htmlFor="quick-handle">
        To
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[16px] font-semibold text-pen/40">
          @
        </span>
        <input
          id="quick-handle"
          className="field h-[2.875rem] pl-8 text-[16px] font-semibold"
          placeholder="handle"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={handle.replace(/^@+/, "")}
          {...suggest.inputProps}
          onChange={(e) => {
            setHandle(e.target.value);
            suggest.typed();
          }}
          onKeyDown={(e) => {
            if (suggest.onKeyDown(e)) return;
            if (e.key === "Enter") review();
          }}
        />
        {suggest.show && <HandleSuggestions {...suggest.listProps} />}
      </div>

      <label className="label mb-1.5 mt-3 block" htmlFor="quick-amount">
        Amount
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[16px] text-pen/45">
          $
        </span>
        <input
          id="quick-amount"
          className="field h-[2.875rem] pl-7 pr-36 text-[16px] font-semibold tabular-nums"
          placeholder="0.00"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(cleanAmount(e.target.value))}
          onKeyDown={(e) => e.key === "Enter" && review()}
        />
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[11.5px] text-pen/45">
          fee paid by Selkie
        </span>
      </div>
      {tooMuch && (
        <p className="mt-2 text-[13px] text-[#f28b9b]">
          That is more than you have (${money(balance)}).
        </p>
      )}

      <button onClick={review} disabled={!ready} className="btn btn-gold mt-3.5 w-full">
        Review <ArrowRight size={16} strokeWidth={2.2} />
      </button>
    </section>
  );
}

/** Money you sent that is still waiting for someone to sign in. */
function waitingFor(entries: ActivityEntry[]): ActivityEntry[] {
  return entries.filter(
    (entry) => entry.kind === "send" && entry.status === "pending" && Boolean(entry.claimRef),
  );
}

/**
 * "Waiting for them": every payment still in escrow, with how long until you
 * could take it back. The bar fills as that day approaches, so a glance says
 * which ones are getting old without reading a single date.
 */
export function WaitingCard({ entries }: { entries: ActivityEntry[] }) {
  const hidden = useAmountsHidden();
  const waiting = waitingFor(entries);
  if (waiting.length === 0) return null;

  const total = waiting.reduce((sum, entry) => sum + Number(entry.amount.amount), 0);
  const now = Date.now();

  return (
    <section className="chunk p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[21px] font-extrabold tracking-[-0.02em]">Waiting for them</h2>
        <span className="font-mono text-[13px] text-pen/45">{hidden ? MASK : `$${money(total)}`}</span>
      </div>
      <ul className="mt-1.5">
        {waiting.slice(0, 5).map((entry) => {
          const sent = Date.parse(entry.at);
          const back = entry.refundableAt ? Date.parse(entry.refundableAt) : NaN;
          const span = back - sent;
          const progress = Number.isFinite(span) && span > 0 ? Math.min(1, Math.max(0, (now - sent) / span)) : 0;
          const name = entry.counterparty ?? "Someone";
          const when = Number.isFinite(back)
            ? back <= now
              ? "you can take it back now"
              : `take back after ${new Date(back).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
            : "waiting for them to sign in";
          return (
            <li
              key={entry.id}
              className="grid grid-cols-[2.125rem_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-pen/[0.06] py-2.5 first:border-t-0"
            >
              <span className="grid h-[2.125rem] w-[2.125rem] place-items-center rounded-full bg-deep font-display text-[13px] font-extrabold text-sg">
                {name.replace(/^@/, "").slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold">{name}</p>
                <p className="mt-0.5 truncate text-[12px] text-pen/45">{when}</p>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-pen/[0.08]">
                  <i
                    className="block h-full rounded-full bg-sg"
                    style={{ width: `${Math.max(3, Math.round(progress * 100))}%` }}
                  />
                </div>
              </div>
              <span className="font-mono text-[14px] tabular-nums">
                {hidden ? MASK : `$${money(entry.amount.amount)}`}
              </span>
            </li>
          );
        })}
      </ul>
      {waiting.length > 5 && (
        <p className="mt-1 text-[12.5px] text-pen/45">and {waiting.length - 5} more in your activity</p>
      )}
    </section>
  );
}
