"use client";

import { ArrowRight, Check, Clock } from "lucide-react";
import { XLogo } from "@/components/Mark";
import { TokenIcon } from "@/components/TokenIcon";

/**
 * The hero product shot.
 *
 * Two surfaces, overlapping: the send screen as the payer sees it, and the
 * notice the person on the other end gets. One card would only show half the
 * idea, and the whole pitch is that both halves are easy.
 *
 * Deliberately not a screenshot. A real screenshot ages the moment a button
 * moves, has to be re-cut for dark mode and every screen width, and ships as
 * a heavyweight image. This is the live design system at the size it is used,
 * so it stays honest for free.
 */
export function SendCard() {
  return (
    <div className="relative mx-auto w-full max-w-sm lg:mx-0">
      {/* The bloom that lifts the whole shot off the water. It stays put inside
          the Reveal's stacking context (the entrance animates `filter`, which
          makes one), so z-index:-1 sits it behind the cards and not behind the
          page. */}
      <span className="lp-halo -inset-8 bg-gold/25" aria-hidden="true" />

      <div className="lp-float">
        <div className="chunk p-5">
          <p className="eyebrow">Send</p>

          <p className="label mt-4">To</p>
          <div className="mt-1.5 flex items-center gap-2.5 rounded-[0.8rem] border-2 border-pen bg-card-bright px-3 py-2.5">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-pen bg-gradient-to-br from-gold-light to-gold-deep font-display text-sm font-bold text-pen"
              aria-hidden="true"
            >
              A
            </span>
            <span className="font-display text-[15px] font-bold tracking-tight text-pen">
              @amaka
            </span>
            <span className="ml-auto text-pen/45">
              <XLogo size={14} />
            </span>
          </div>

          <p className="label mt-4">Amount</p>
          <div className="mt-1.5 flex items-baseline gap-2 rounded-[0.8rem] border-2 border-pen bg-card-bright px-3 py-2.5">
            <span className="font-display text-[2rem] font-bold leading-none tracking-tight tabular-nums text-pen">
              $25.00
            </span>
            <span className="ml-auto flex items-center gap-1.5 text-[13px] font-bold text-pen/50">
              <TokenIcon asset="USDC" size={18} />
              USDC
            </span>
          </div>

          <div className="btn btn-gold mt-4 w-full">
            Send $25.00 <ArrowRight size={16} strokeWidth={2.6} />
          </div>

          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[12.5px] font-medium text-pen/50">
            <Clock size={12} strokeWidth={2.4} />
            She has not joined yet, so it waits for her
          </p>
        </div>
      </div>

      {/* The other side of the same payment, tucked under the near corner. */}
      <div
        className="lp-float absolute -bottom-9 -left-4 w-[15.5rem] sm:-left-10"
        style={{ animationDelay: "-3.2s" }}
      >
        <div className="chunk flex items-center gap-3 p-3.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#2f7d3f]/12 text-[#2f7d3f]">
            <Check size={17} strokeWidth={2.8} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-[15px] font-bold leading-tight tracking-tight text-pen">
              +$25.00
            </p>
            <p className="mt-0.5 truncate text-[12.5px] font-medium text-pen/55">
              landed the moment she signed in
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
