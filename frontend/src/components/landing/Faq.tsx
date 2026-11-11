"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

const QUESTIONS: { q: string; a: string }[] = [
  {
    q: "Does the person I am paying need an account?",
    a: "No. That is the whole point. You send to their handle and the money is held for them. When they sign in for the first time, with one tap, it is already there. If they never turn up, you take it back.",
  },
  {
    q: "What does it cost?",
    a: "Opening your account is free, and the person you pay never pays anything to receive. We cover the network cost of every payment, so a small amount stays a small amount.",
  },
  {
    q: "How long does it take to arrive?",
    a: "Seconds. If the person you paid has already signed in once, it is in their balance before you have closed the tab.",
  },
  {
    q: "What if I send to the wrong handle?",
    a: "If they have not claimed it yet, you can take it back from your activity list and the money returns to you in full. Once someone has claimed a payment it belongs to them, the same as cash.",
  },
  {
    q: "Is there anything to write down or keep safe?",
    a: "Nothing. No long code, no twelve words, no file to back up. You sign in the way you already sign in to everything else, and your money is there.",
  },
  {
    q: "Can I get the money out?",
    a: "Yes. You can send it on to anyone, move it to an account you already use, or cash out. You are never locked in.",
  },
  {
    q: "Where is my money actually kept?",
    a: "In an account that belongs to you and nobody else, with its own address you can look up at any time. We cannot spend it and we cannot freeze it.",
  },
];

/**
 * The questions people ask before they will put money into something.
 *
 * One open at a time. An accordion where every row can be open at once turns
 * into the wall of text the accordion was there to avoid.
 */
export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div>
      {QUESTIONS.map((item, index) => {
        const isOpen = open === index;
        return (
          <div key={item.q} className={`lp-faq ${isOpen ? "lp-faq-open" : ""}`}>
            <button
              onClick={() => setOpen(isOpen ? null : index)}
              aria-expanded={isOpen}
              className="lp-faq-q"
            >
              <span className="font-display text-[17px] font-bold tracking-tight sm:text-[19px]">
                {item.q}
              </span>
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border border-ivory/15 transition-transform duration-300 ${
                  isOpen ? "rotate-45 border-gold/40 bg-gold/15 text-gold" : "text-ivory/50"
                }`}
                aria-hidden="true"
              >
                <Plus size={16} strokeWidth={2.6} />
              </span>
            </button>

            {/* Always mounted, never conditionally rendered: the row animates
                from 0fr to 1fr, and there is nothing to animate to if the
                answer only enters the DOM once it is already open. */}
            <div className="lp-faq-a">
              <div>
                <p className="max-w-2xl pb-6 pr-12 text-[15px] leading-relaxed text-ivory/60 sm:text-base">
                  {item.a}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
