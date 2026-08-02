"use client";

import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Clock, Repeat, Sparkles } from "lucide-react";
import type { ActivityEntry } from "@/lib/api";
import { DOLLAR, dayKey, dayLabel, money, timeAgo, usd } from "@/lib/format";

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
}: {
  entries: ActivityEntry[];
  loading: boolean;
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
      <div className="chunk mt-6 p-8 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-gold/15 text-gold-ink">
          <Sparkles size={22} strokeWidth={2.2} />
        </span>
        <p className="mt-4 font-display text-lg font-bold tracking-tight">Nothing here yet</p>
        <p className="mx-auto mt-1.5 max-w-xs text-[15px] leading-relaxed text-pen/60">
          Send a few dollars to any X handle. They do not need an account, and it waits for them
          until they sign in.
        </p>
      </div>
    );
  }

  return (
    <section className="mt-8">
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
                <Row key={entry.id} entry={entry} />
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

function Row({ entry }: { entry: ActivityEntry }) {
  const incoming = INCOMING[entry.kind] ?? false;
  const waiting = entry.status === "pending";
  const isDollars = entry.amount.asset === DOLLAR;
  const amount = isDollars
    ? usd(entry.amount.amount)
    : `${money(entry.amount.amount)} ${entry.amount.asset}`;

  return (
    <div className="flex items-center gap-3.5 border-t-2 border-pen/[0.07] px-5 py-3.5 first:border-t-0">
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
          incoming ? "bg-[#2f7d3f]/12 text-[#2f7d3f]" : "bg-pen/[0.07] text-pen/70"
        }`}
      >
        <Icon kind={entry.kind} waiting={waiting} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold tracking-tight">{title(entry)}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium text-pen/50">
          {waiting && !incoming && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2 py-0.5 text-[11px] font-bold text-gold-ink">
              <Clock size={10} strokeWidth={2.6} /> Waiting
            </span>
          )}
          {timeAgo(entry.at)}
        </p>
      </div>

      <span
        className={`shrink-0 font-display text-[15px] font-bold tabular-nums ${
          incoming ? "text-[#2f7d3f]" : "text-pen"
        }`}
      >
        {incoming ? "+" : "−"}
        {amount}
      </span>
    </div>
  );
}

function Icon({ kind, waiting }: { kind: ActivityEntry["kind"]; waiting: boolean }) {
  if (kind === "swap") return <Repeat size={16} strokeWidth={2.3} />;
  if (kind === "claim") return <Sparkles size={16} strokeWidth={2.3} />;
  if (kind === "receive") return <ArrowDownLeft size={17} strokeWidth={2.4} />;
  return waiting ? <Clock size={16} strokeWidth={2.3} /> : <ArrowUpRight size={17} strokeWidth={2.4} />;
}

/** What a row says. Plain sentences, never a transaction type. */
function title(entry: ActivityEntry): string {
  switch (entry.kind) {
    case "receive":
      return entry.counterparty ? `From ${entry.counterparty}` : "Money in";
    case "claim":
      return "Money that was waiting for you";
    case "swap":
      return entry.counterparty ? `Converted to ${entry.counterparty}` : "Converted";
    default:
      return entry.counterparty ? `Sent to ${entry.counterparty}` : "Money out";
  }
}

function FeedSkeleton() {
  return (
    <section className="mt-8">
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
