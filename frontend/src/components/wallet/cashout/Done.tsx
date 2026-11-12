"use client";

import Link from "next/link";
import { Clock, ExternalLink, RotateCcw } from "lucide-react";
import type { ChainAsset, SendResult } from "@/lib/api";
import { money } from "@/lib/format";
import { BankTimeline } from "./BankFields";
import { Timeline } from "./bits";
import { IntentsTimeline } from "./IntentsTimeline";

/** A check that draws itself once. */
function Seal() {
  return (
    <span className="co-seal" aria-hidden="true">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

/**
 * Money left, for real: the amount, where it went, how far it has got, and
 * the transaction to check it by. A move to another chain keeps reading NEAR
 * Intents until it has arrived, come back, or failed; a cash-out to a bank
 * reads both NEAR Intents and Paycrest until the bank has it.
 */
export function DoneStep({
  amount,
  to,
  result,
  chain,
  onAgain,
}: {
  amount: string;
  /** Already shortened for reading. */
  to: string;
  result: SendResult;
  /** Set for a cash-out to another chain, to follow the swap. */
  chain?: ChainAsset;
  onAgain: () => void;
}) {
  const following = Boolean((chain && result.intents) || result.bank);

  return (
    <div className="flex flex-col items-center text-center">
      <Seal />
      <p className="co-kicker mt-5">
        <i aria-hidden="true" />
        {following ? "On its way" : "Sent"}
      </p>
      <p className="co-big mt-2">
        {money(amount)} <span className="co-mono text-[15px] font-normal tracking-normal text-[rgba(233,241,236,.5)]">USDC</span>
      </p>
      <p className="co-mono mt-2 max-w-sm break-all text-[13.5px] text-[rgba(233,241,236,.72)]">to {to}</p>
      <p className="co-blurb mx-auto text-center">{result.message}</p>

      <div className="co-receipt mt-6 w-full p-5 text-left">
        {result.bank ? (
          <BankTimeline order={result.bank} />
        ) : following && chain && result.intents ? (
          <IntentsTimeline depositAddress={result.intents.depositAddress} direction="out" asset={chain} />
        ) : (
          <Timeline
            stages={[
              { title: "Signed by you", detail: "With your own key, on this device.", state: "done" },
              { title: "Sent", detail: "Selkie's relayer paid the network fee.", state: "done" },
              { title: `Arrived in ${to}`, detail: "Money sent to an account cannot be pulled back.", state: "done" },
            ]}
          />
        )}
        {result.explorer && (
          <a href={result.explorer} target="_blank" rel="noreferrer" className="co-link mt-5">
            See it on the NEAR explorer <ExternalLink size={12} />
          </a>
        )}
      </div>

      <div className="mt-6 grid w-full gap-3 sm:grid-cols-2">
        <button type="button" className="co-btn" onClick={onAgain}>
          <RotateCcw size={15} strokeWidth={2.4} /> Cash out again
        </button>
        <Link href="/wallet/home" className="co-ghost">
          Back to my wallet
        </Link>
      </div>
    </div>
  );
}

/**
 * The end of the bank route, for now. Honest rather than triumphant: the
 * piece that actually moves the money is not built, and a fake receipt would
 * be a worse thing to ship than this.
 */
export function NotYet({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex flex-col items-center py-2 text-center">
      <span className="co-seal" data-tone="wait" aria-hidden="true">
        <Clock size={26} strokeWidth={2.2} />
      </span>
      <div className="mt-5">
        <p className="co-title">Almost open</p>
      </div>
      <p className="co-blurb mx-auto text-center">
        Cashing out here is the last piece we are putting in. Your money is exactly where you left it, and this will
        start working without you having to do anything.
      </p>
      <div className="mt-7 grid w-full gap-3 sm:grid-cols-2">
        <Link href="/wallet/home" className="co-btn">
          Back to my wallet
        </Link>
        <button type="button" className="co-ghost" onClick={onDone}>
          Have another look
        </button>
      </div>
    </div>
  );
}
