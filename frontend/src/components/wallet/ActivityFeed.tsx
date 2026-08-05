"use client";

import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Clock, Loader2, Repeat, Sparkles, Undo2 } from "lucide-react";
import { TokenIcon } from "@/components/TokenIcon";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, api, type ActivityEntry } from "@/lib/api";
import { dayKey, dayLabel, money, timeAgo } from "@/lib/format";
import { MASK, useAmountsHidden } from "@/lib/privacy";

type Filter = "all" | "in" | "out";

/** Money coming in reads positive; money leaving reads negative. */
const INCOMING: Record<string, boolean> = { receive: true, claim: true };

const PAGE = 8;

/**
 * The activity feed.
 *
 * Three things keep a payment history readable as it grows: day headings, so
 * "when" is answered once per group instead of once per row; a cap, so the page
 * never becomes a scroll marathon; and rows compact enough to scan down the
 * right-hand column and see only the money.
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

  // Group after slicing, so "Show more" never reshuffles what is already read.
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; rows: ActivityEntry[] }>();
    for (const entry of visible) {
      const key = dayKey(entry.at);
      const group = map.get(key) ?? { label: dayLabel(entry.at), rows: [] };
      group.rows.push(entry);
      map.set(key, group);
    }
    return [...map.values()];
  }, [visible]);

  if (loading) return <FeedSkeleton />;

  if (entries.length === 0) {
    return (
      <div className="chunk p-8 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-gold/15 text-gold-ink">
          <Sparkles size={22} strokeWidth={2.2} />
        </span>
        <p className="mt-4 font-display text-lg font-bold tracking-tight">Nothing here yet</p>
        <p className="mx-auto mt-1.5 max-w-xs text-[15px] leading-relaxed text-pen/60">
          Send a few dollars to any X or Telegram handle. They do not need an account, and it waits
          for them until they sign in.
        </p>
      </div>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold tracking-tight text-ivory">Activity</h2>
        {entries.length > 4 && (
          <div className="flex gap-1.5">
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
                className={`chip h-8 px-3 text-[13px] ${filter === key ? "chip-on" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="chunk mt-3 p-6 text-center text-[15px] text-pen/60">
          Nothing {filter === "in" ? "came in" : "went out"} yet.
        </p>
      ) : (
        <div className="chunk mt-3 overflow-hidden">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="bg-pen/[0.04] px-5 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-pen/45">
                {group.label}
              </p>
              {group.rows.map((entry) => (
                <Row key={entry.id} entry={entry} onChanged={onChanged} />
              ))}
            </div>
          ))}
        </div>
      )}

      {shown < filtered.length && (
        <button
          onClick={() => setShown((current) => current + 20)}
          className="btn btn-dim btn-sm mx-auto mt-4 flex"
        >
          Show more
        </button>
      )}
    </section>
  );
}

function Row({ entry, onChanged }: { entry: ActivityEntry; onChanged: () => void }) {
  const toast = useToast();
  const hidden = useAmountsHidden();
  const [returning, setReturning] = useState(false);

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
    if (!entry.claimRef) return;
    setReturning(true);
    try {
      const { message } = await api.refund(entry.claimRef);
      toast("success", message);
      onChanged();
    } catch (error) {
      toast("error", error instanceof ApiError ? error.message : "We could not take that back.");
    } finally {
      setReturning(false);
    }
  };

  return (
    <div className="flex items-center gap-3 border-t-2 border-pen/[0.07] px-4 py-3.5 first:border-t-0 sm:gap-3.5 sm:px-5">
      {/* Direction first, as a boxed arrow: which way the money went is the one
          thing worth knowing before reading anything else in the row. */}
      <span
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border-2 ${
          returned
            ? "border-pen/15 bg-pen/[0.05] text-pen/45"
            : incoming
              ? "border-[#2f7d3f]/25 bg-[#2f7d3f]/10 text-[#2f7d3f]"
              : "border-[#b91c34]/25 bg-[#b91c34]/[0.08] text-[#b91c34]"
        }`}
      >
        <Icon kind={entry.kind} waiting={waiting} returned={returned} />
      </span>

      <TokenIcon asset={entry.amount.asset} size={30} />

      <div className="min-w-0 flex-1">
        <p
          className={`flex items-baseline gap-1.5 font-display text-[17px] font-bold tracking-tight tabular-nums ${
            // Money in reads green, money out reads red, at a glance and
            // without reading the number. Returned money is neither: it never
            // went anywhere, so it is struck out and greyed instead.
            returned ? "text-pen/40 line-through" : incoming ? "text-[#2f7d3f]" : "text-[#b91c34]"
          }`}
        >
          <span>
            {incoming ? "+" : "−"}
            {hidden ? MASK : money(entry.amount.amount)}
          </span>
          <span className="text-[13px] font-bold text-pen/45">{entry.amount.asset}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 truncate text-[13px] font-medium text-pen/50">
          {waiting && !incoming && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2 py-0.5 text-[11px] font-bold text-gold-ink">
              <Clock size={10} strokeWidth={2.6} /> Waiting
            </span>
          )}
          {returned && (
            <span className="inline-flex items-center gap-1 rounded-full bg-pen/[0.09] px-2 py-0.5 text-[11px] font-bold text-pen/60">
              <Undo2 size={10} strokeWidth={2.6} /> Back with you
            </span>
          )}
          {title(entry)}
        </p>
      </div>

      {canTakeBack && (
        <button
          onClick={() => void takeBack()}
          disabled={returning}
          className="btn btn-dim btn-sm shrink-0"
        >
          {returning ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
          {returning ? "Returning" : "Take it back"}
        </button>
      )}

      <span className="shrink-0 text-[13px] font-semibold text-pen/40">{timeAgo(entry.at)}</span>
    </div>
  );
}

function Icon({
  kind,
  waiting,
  returned,
}: {
  kind: ActivityEntry["kind"];
  waiting: boolean;
  returned: boolean;
}) {
  if (returned) return <Undo2 size={16} strokeWidth={2.3} />;
  if (kind === "swap") return <Repeat size={16} strokeWidth={2.3} />;
  if (kind === "claim") return <Sparkles size={16} strokeWidth={2.3} />;
  if (kind === "receive") return <ArrowDownLeft size={17} strokeWidth={2.4} />;
  return waiting ? <Clock size={16} strokeWidth={2.3} /> : <ArrowUpRight size={17} strokeWidth={2.4} />;
}

/**
 * The line under the amount. Plain sentences, never a transaction type.
 *
 * Lower case and short, because it sits beneath the number rather than above it
 * and is read second. "from @amaka" is a caption; "From @amaka" is a heading
 * competing with the money for the eye.
 */
function title(entry: ActivityEntry): string {
  switch (entry.kind) {
    case "receive":
      return entry.counterparty ? `from ${entry.counterparty}` : "money in";
    case "claim":
      return "was waiting for you";
    case "swap":
      return entry.counterparty ? `converted to ${entry.counterparty}` : "converted";
    default:
      return entry.counterparty ? `to ${entry.counterparty}` : "money out";
  }
}

function FeedSkeleton() {
  return (
    <section>
      <div className="h-6 w-24 rounded-lg bg-ivory/[0.07]" />
      <div className="chunk mt-3 overflow-hidden">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-3.5 border-t-2 border-pen/[0.07] px-5 py-3.5 first:border-t-0">
            <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-pen/[0.08]" />
            <div className="flex-1">
              <span className="block h-3.5 w-32 animate-pulse rounded bg-pen/[0.08]" />
              <span className="mt-2 block h-3 w-16 animate-pulse rounded bg-pen/[0.06]" />
            </div>
            <span className="h-4 w-14 animate-pulse rounded bg-pen/[0.08]" />
          </div>
        ))}
      </div>
    </section>
  );
}
