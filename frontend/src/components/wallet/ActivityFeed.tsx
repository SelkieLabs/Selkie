"use client";

import { Avatar } from "@/components/Layout";
import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Clock,
  Loader2,
  Repeat,
  Sparkles,
  Undo2,
} from "lucide-react";
import { ChainLogo } from "@/components/ChainLogo";
import { TransactionSheet } from "@/components/wallet/TransactionSheet";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/useConfirm";
import { ApiError, api, type ActivityEntry } from "@/lib/api";
import { features, isNear } from "@/lib/chain";
import { chainInLabel } from "@/lib/logos";
import { useNearPay } from "@/lib/near-wallet";
import { dayLabel, money } from "@/lib/format";
import { MASK, useAmountsHidden } from "@/lib/privacy";

type Filter = "all" | "in" | "out";

/** Money coming in reads positive; money leaving reads negative. */
const INCOMING: Record<string, boolean> = { receive: true, claim: true };

const PAGE = 8;

/**
 * The activity feed.
 *
 * One row per payment: who, when, its state as one word, and the money in the
 * right-hand column so you can scan down it and see only that. Money that came
 * in is gold, the one place gold is spent. A cap keeps the page from becoming a
 * scroll marathon.
 */
export function ActivityFeed({
  entries,
  loading,
  onChanged,
}: {
  entries: ActivityEntry[];
  loading: boolean;
  /** Taking money back changes the balance, so the shell reloads after it. */
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);

  const filtered = useMemo(
    () =>
      entries.filter((entry) => {
        if (filter === "all") return true;
        const incoming = INCOMING[entry.kind] ?? false;
        return filter === "in" ? incoming : !incoming;
      }),
    [entries, filter],
  );

  const visible = filtered.slice(0, shown);

  if (loading) return <FeedSkeleton />;

  if (entries.length === 0) {
    return (
      <div className="chunk px-6 py-10 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-sg/[0.12] text-sg">
          <Sparkles size={22} strokeWidth={2} />
        </span>
        <p className="mt-4 font-display text-lg font-extrabold tracking-tight">Nothing here yet</p>
        <p className="mx-auto mt-1.5 max-w-xs text-[15px] leading-relaxed text-pen/55">
          Send a few dollars to any {features.telegram ? "X or Telegram" : "X"} handle. They do not
          need an account, and it waits for them until they sign in.
        </p>
      </div>
    );
  }

  return (
    <section className="chunk px-4 pb-1.5 pt-1 sm:px-5">
      <div className="flex items-center justify-between gap-3 pb-2 pt-3.5">
        <h2 className="font-display text-[19px] font-extrabold tracking-[-0.02em]">Activity</h2>
        {entries.length > 4 && (
          <div className="seg !grid-cols-3 !p-0.5" role="group" aria-label="Show">
            {(
              [
                ["all", "All"],
                ["in", "In"],
                ["out", "Out"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  setFilter(key);
                  setShown(PAGE);
                }}
                aria-pressed={filter === key}
                className={`seg-btn !h-7 px-3 text-[12.5px] ${filter === key ? "seg-on" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="border-t border-pen/[0.06] py-6 text-center text-[14.5px] text-pen/50">
          Nothing {filter === "in" ? "came in" : "went out"} yet.
        </p>
      ) : (
        <div>
          {visible.map((entry) => (
            <Row key={entry.id} entry={entry} onChanged={onChanged} />
          ))}
        </div>
      )}

      {shown < filtered.length && (
        <div className="border-t border-pen/[0.06] py-2.5 text-center">
          <button
            onClick={() => setShown((current) => current + 20)}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-pen/55 transition-colors duration-150 hover:bg-pen/[0.05] hover:text-pen"
          >
            Show more
          </button>
        </div>
      )}
    </section>
  );
}

function Row({ entry, onChanged }: { entry: ActivityEntry; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const nearPay = useNearPay();
  const hidden = useAmountsHidden();
  const [returning, setReturning] = useState(false);
  const [open, setOpen] = useState(false);

  const incoming = INCOMING[entry.kind] ?? false;
  const waiting = entry.status === "pending";
  const returned = entry.status === "returned";

  // Money can only come back once it has finished waiting, so the button only
  // appears when pressing it would actually work.
  const canTakeBack =
    waiting &&
    !incoming &&
    Boolean(entry.claimRef) &&
    (!entry.refundableAt || Date.parse(entry.refundableAt) <= Date.now());

  const takeBack = async () => {
    const claimRef = entry.claimRef;
    if (!claimRef) return;
    const amount = `${money(entry.amount.amount)} ${entry.amount.asset}`;
    const yes = await confirm({
      title: `Take back ${amount}?`,
      confirm: "Take it back",
      rows: [
        ...(entry.counterparty ? [{ label: "It was for", value: entry.counterparty }] : []),
        { label: "Comes back", value: amount },
      ],
      body: "It was never claimed, so it comes back to your account and the link stops working.",
    });
    if (!yes) return;
    setReturning(true);
    try {
      // On NEAR only the sender's own key can take it back; Selkie relays it.
      const { message } = isNear
        ? await nearPay(() => api.near.prepareRefund(claimRef))
        : await api.refund(claimRef);
      toast("success", message);
      setOpen(false);
      onChanged();
    } catch (error) {
      toast(
        "error",
        error instanceof ApiError
          ? error.message
          : "That did not go through. Your money is still waiting.",
      );
    } finally {
      setReturning(false);
    }
  };

  const status = statusOf(entry, incoming);
  const sub = [dayLabel(entry.at), detail(entry, incoming)].filter(Boolean).join(" · ");

  return (
    <>
      <div
        // The whole row opens the payment, so the target is the size of the row
        // rather than a link somewhere inside it. Not a <button>: the take-back
        // button lives in here, and a button inside a button is invalid.
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="group -mx-2 flex cursor-pointer items-center gap-3 rounded-xl border-t border-pen/[0.06] px-2 py-3 transition-colors duration-150 hover:bg-pen/[0.03] focus-visible:bg-pen/[0.05] focus-visible:outline-none sm:gap-3.5"
      >
        <span
          className={`grid h-[2.375rem] w-[2.375rem] shrink-0 place-items-center overflow-hidden rounded-full font-display text-[14px] font-extrabold ${
            waiting && !incoming ? "bg-deep text-sg" : "bg-tide-2 text-pen/70"
          }`}
        >
          <Face entry={entry} waiting={waiting} returned={returned} />
        </span>

        <div className="min-w-0 flex-1">
          <p className={`truncate text-[14.5px] font-semibold ${returned ? "text-pen/45" : ""}`}>
            {title(entry)}
          </p>
          <p className="mt-0.5 flex min-w-0 items-center gap-2 text-[12.5px] text-pen/45">
            <span className={`st sm:hidden ${status.className}`}>{status.label}</span>
            <span className="truncate">{sub}</span>
          </p>
        </div>

        {canTakeBack && (
          <button
            // The row underneath opens the payment. Without this, taking money
            // back would also throw a sheet up over the confirmation.
            onClick={(event) => {
              event.stopPropagation();
              void takeBack();
            }}
            disabled={returning}
            className="btn btn-dim btn-sm hidden !h-8 shrink-0 !px-3 !text-[12.5px] md:inline-flex"
          >
            {returning ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
            {returning ? "Returning" : "Take it back"}
          </button>
        )}

        <span className={`st hidden shrink-0 sm:inline-flex ${status.className}`}>{status.label}</span>

        <span
          className={`w-[5.75rem] shrink-0 text-right font-mono text-[14.5px] tabular-nums ${
            returned ? "text-pen/35 line-through" : incoming ? "text-[#d9a441]" : "text-[#b91c34]"
          }`}
        >
          {incoming ? "+" : "−"}
          {hidden ? MASK : `$${money(entry.amount.amount)}`}
        </span>
      </div>

      {/* Outside the row, deliberately. The sheet is portaled to <body>, but a
          portal still bubbles its clicks up the React tree: rendered inside the
          row, dismissing it would immediately reopen it. */}
      {open && (
        <TransactionSheet
          entry={entry}
          incoming={incoming}
          canTakeBack={canTakeBack}
          returning={returning}
          onTakeBack={() => void takeBack()}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Face({
  entry,
  waiting,
  returned,
}: {
  entry: ActivityEntry;
  waiting: boolean;
  returned: boolean;
}) {
  if (returned) return <Undo2 size={16} strokeWidth={2.2} />;
  const { kind, counterparty } = entry;
  // A cash-out to another chain ("0x5a…eAed on Base") shows that chain's mark.
  const chain = chainInLabel(counterparty);
  if (chain) return <ChainLogo blockchain={chain} name={counterparty ?? chain} size={22} />;
  // A person reads as their face: their X photo when they are on Selkie, and
  // their own creature when they are not, the way people are drawn everywhere
  // else in the app.
  if (counterparty?.startsWith("@")) return <Avatar name={counterparty} src={entry.counterpartyAvatar} size={38} />;
  if (kind === "cashout") return <Banknote size={16} strokeWidth={2.2} />;
  if (kind === "swap") return <Repeat size={16} strokeWidth={2.2} />;
  if (kind === "claim") return <Sparkles size={16} strokeWidth={2.2} />;
  if (kind === "receive") return <ArrowDownLeft size={17} strokeWidth={2.2} />;
  return waiting ? <Clock size={16} strokeWidth={2.2} /> : <ArrowUpRight size={17} strokeWidth={2.2} />;
}

/**
 * The state of a payment as one word. Waiting is the only one drawn in the
 * accent, because it is the only one you might still act on.
 */
function statusOf(entry: ActivityEntry, incoming: boolean): { label: string; className: string } {
  if (entry.status === "failed") return { label: "Failed", className: "st-bad" };
  if (entry.status === "returned") return { label: "Returned", className: "" };
  if (entry.status === "pending") {
    return incoming ? { label: "On its way", className: "" } : { label: "Waiting", className: "st-wait" };
  }
  switch (entry.kind) {
    case "receive":
    case "claim":
      return { label: "Received", className: "" };
    case "cashout":
      return { label: "Cashed out", className: "" };
    case "swap":
      return { label: "Converted", className: "" };
    case "send":
      // Money that waited and was then picked up keeps its escrow id.
      return { label: entry.claimRef ? "Claimed" : "Sent", className: "" };
    default:
      return { label: "Done", className: "" };
  }
}

/** The second half of the line under the title: what happens next, if anything. */
function detail(entry: ActivityEntry, incoming: boolean): string {
  if (entry.status === "pending" && !incoming) {
    if (!entry.refundableAt) return "waiting for them";
    const at = Date.parse(entry.refundableAt);
    return at <= Date.now()
      ? "you can take it back"
      : `take back after ${new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }
  if (entry.status === "returned") return "back with you";
  return "";
}

/** The row's heading. Plain sentences, never a transaction type. */
function title(entry: ActivityEntry): string {
  switch (entry.kind) {
    case "receive":
      return entry.counterparty ? `From ${entry.counterparty}` : "Money in";
    case "claim":
      return "Was waiting for you";
    case "swap":
      return entry.counterparty ? `Converted to ${entry.counterparty}` : "Converted";
    case "cashout":
      return entry.counterparty ? `Cashed out to ${entry.counterparty}` : "Cashed out";
    default:
      return entry.counterparty ? `To ${entry.counterparty}` : "Money out";
  }
}

function FeedSkeleton() {
  return (
    <section className="chunk px-4 pb-2 pt-1 sm:px-5" aria-label="Loading activity">
      <div className="pb-2 pt-3.5">
        <span className="skel block h-5 w-20 rounded-md" />
      </div>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3.5 border-t border-pen/[0.06] py-3">
          <span className="skel h-[2.375rem] w-[2.375rem] shrink-0 rounded-full" />
          <div className="flex-1">
            <span className="skel block h-3.5 w-32 rounded" />
            <span className="skel mt-2 block h-3 w-20 rounded" />
          </div>
          <span className="skel h-4 w-16 rounded" />
        </div>
      ))}
    </section>
  );
}
