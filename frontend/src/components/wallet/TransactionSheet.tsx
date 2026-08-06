"use client";

import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Repeat,
  Sparkles,
  Undo2,
} from "lucide-react";
import { Avatar } from "@/components/Layout";
import { PlatformLogo } from "@/components/Mark";
import { Sheet } from "@/components/Sheet";
import { TokenIcon } from "@/components/TokenIcon";
import { useToast } from "@/contexts/ToastContext";
import type { ActivityEntry } from "@/lib/api";
import { exactTime, money, shortAddress } from "@/lib/format";
import { explorer } from "@/lib/explorer";

/**
 * One payment, opened up.
 *
 * The feed answers "how much, to whom, roughly when" and stops there on
 * purpose. This answers everything else: the exact moment, what state it is in,
 * the reference to quote if something needs chasing, and the way out to the
 * public record for anyone who wants to see it settled with their own eyes.
 *
 * It is a read-only screen with one exception. Money still waiting can be taken
 * back from here, because this is where somebody ends up when they open a
 * payment wondering why it has not landed.
 */
export function TransactionSheet({
  entry,
  incoming,
  canTakeBack,
  returning,
  onTakeBack,
  onClose,
}: {
  entry: ActivityEntry;
  incoming: boolean;
  canTakeBack: boolean;
  returning: boolean;
  onTakeBack: () => void;
  onClose: () => void;
}) {
  const waiting = entry.status === "pending";
  const returned = entry.status === "returned";
  const failed = entry.status === "failed";
  const handle = entry.counterpartyHandle;

  // Waiting money that is not yet old enough to recall. The feed hides the
  // button in this case and says nothing, which reads as the feature missing.
  const waitUntil =
    waiting && !incoming && entry.refundableAt && Date.parse(entry.refundableAt) > Date.now()
      ? entry.refundableAt
      : null;

  return (
    <Sheet title="Payment details" onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        <span
          className={`grid h-14 w-14 place-items-center rounded-2xl border-2 ${
            returned || failed
              ? "border-pen/15 bg-pen/[0.05] text-pen/45"
              : incoming
                ? "border-[#2f7d3f]/25 bg-[#2f7d3f]/10 text-[#2f7d3f]"
                : "border-[#b91c34]/25 bg-[#b91c34]/[0.08] text-[#b91c34]"
          }`}
        >
          <Face kind={entry.kind} waiting={waiting} returned={returned} />
        </span>

        <p
          className={`mt-4 flex items-baseline gap-2 font-display text-[2.5rem] font-bold leading-none tracking-tight tabular-nums ${
            returned || failed
              ? "text-pen/40"
              : incoming
                ? "text-[#2f7d3f]"
                : "text-[#b91c34]"
          }`}
        >
          <span>
            {incoming ? "+" : "−"}
            {money(entry.amount.amount)}
          </span>
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-[14px] font-bold text-pen/50">
          <TokenIcon asset={entry.amount.asset} size={18} />
          {entry.amount.asset}
        </p>

        <p className="mt-4 font-display text-lg font-bold tracking-tight">{headline(entry)}</p>
        <Status waiting={waiting} returned={returned} failed={failed} incoming={incoming} />
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border-2 border-pen/15">
        {handle && (
          <Line label={incoming ? "From" : "To"}>
            <span className="flex items-center gap-2">
              <Avatar name={`@${handle.username}`} size={22} />@{handle.username}
              <PlatformLogo platform={handle.platform} size={12} />
            </span>
          </Line>
        )}
        {!handle && entry.counterparty && (
          <Line label={incoming ? "From" : "To"}>
            <span className="font-mono text-[13px]">{entry.counterparty}</span>
          </Line>
        )}

        <Line label="When">{exactTime(entry.at)}</Line>

        {waitUntil && <Line label="Can be taken back">{exactTime(waitUntil)}</Line>}

        {entry.ref && (
          <Line label="Reference">
            <CopyRef value={entry.ref} />
          </Line>
        )}
      </div>

      {canTakeBack && (
        <button onClick={onTakeBack} disabled={returning} className="btn btn-dark mt-4 w-full">
          {returning ? <Loader2 size={16} className="animate-spin" /> : <Undo2 size={16} />}
          {returning ? "Returning" : "Take it back"}
        </button>
      )}

      {entry.ref ? (
        <a
          href={explorer.transaction(entry.ref)}
          target="_blank"
          rel="noreferrer"
          className="btn btn-dim mt-3 w-full"
        >
          View on explorer <ExternalLink size={15} strokeWidth={2.4} />
        </a>
      ) : (
        // No reference means nothing settled publicly yet. A link to a page
        // that will say "not found" is worse than no link.
        <p className="mt-4 text-center text-[13px] leading-relaxed text-pen/50">
          This one is still waiting, so there is nothing on the public record yet.
        </p>
      )}
    </Sheet>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t-2 border-pen/[0.07] px-4 py-3 first:border-t-0">
      <span className="shrink-0 text-[13px] font-bold text-pen/45">{label}</span>
      <span className="min-w-0 truncate text-right text-[14px] font-semibold">{children}</span>
    </div>
  );
}

/** The reference, shortened, and one tap to take the whole thing. */
function CopyRef({ value }: { value: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("error", "Your browser would not let us copy that.");
    }
  };

  return (
    <button
      onClick={() => void copy()}
      aria-label="Copy the reference"
      className="inline-flex items-center gap-1.5 font-mono text-[13px] font-semibold transition-colors hover:text-pen"
    >
      {shortAddress(value)}
      {copied ? (
        <Check size={13} strokeWidth={2.8} className="text-[#2f7d3f]" />
      ) : (
        <Copy size={13} strokeWidth={2.4} className="text-pen/40" />
      )}
    </button>
  );
}

function Status({
  waiting,
  returned,
  failed,
  incoming,
}: {
  waiting: boolean;
  returned: boolean;
  failed: boolean;
  incoming: boolean;
}) {
  if (returned) {
    return (
      <Pill className="bg-pen/[0.09] text-pen/60">
        <Undo2 size={12} strokeWidth={2.6} /> Back with you
      </Pill>
    );
  }
  if (failed) {
    return <Pill className="bg-[#a11d34]/10 text-[#a11d34]">Did not go through</Pill>;
  }
  if (waiting && !incoming) {
    return (
      <Pill className="bg-gold/20 text-gold-ink">
        <Clock size={12} strokeWidth={2.6} /> Waiting to be claimed
      </Pill>
    );
  }
  return (
    <Pill className="bg-[#2f7d3f]/12 text-[#2f7d3f]">
      <Check size={12} strokeWidth={2.8} /> Done
    </Pill>
  );
}

function Pill({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span
      className={`mt-2.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold ${className}`}
    >
      {children}
    </span>
  );
}

function Face({
  kind,
  waiting,
  returned,
}: {
  kind: ActivityEntry["kind"];
  waiting: boolean;
  returned: boolean;
}) {
  if (returned) return <Undo2 size={22} strokeWidth={2.2} />;
  if (kind === "cashout") return <Banknote size={22} strokeWidth={2.2} />;
  if (kind === "swap") return <Repeat size={22} strokeWidth={2.2} />;
  if (kind === "claim") return <Sparkles size={22} strokeWidth={2.2} />;
  if (kind === "receive") return <ArrowDownLeft size={23} strokeWidth={2.3} />;
  return waiting ? <Clock size={22} strokeWidth={2.2} /> : <ArrowUpRight size={23} strokeWidth={2.3} />;
}

/** A whole sentence, unlike the feed's caption. This one is read on its own. */
function headline(entry: ActivityEntry): string {
  const who = entry.counterpartyHandle
    ? `@${entry.counterpartyHandle.username}`
    : entry.counterparty;

  switch (entry.kind) {
    case "receive":
      return who ? `From ${who}` : "Money in";
    case "claim":
      return "Was waiting for you";
    case "swap":
      return who ? `Converted to ${who}` : "Converted";
    case "cashout":
      return who ? `Cashed out to ${who}` : "Cashed out";
    default:
      return who ? `To ${who}` : "Money out";
  }
}
