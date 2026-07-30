import { useCallback, useEffect, useState, type SubmitEvent } from "react";
import { Link, Navigate, NavLink, useParams, useSearchParams } from "react-router-dom";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowUpRight,
  AtSign,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Fingerprint,
  HandCoins,
  Inbox,
  Link2,
  Lock,
  RefreshCw,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import { Avatar, Header, Shell, Spinner } from "../components/Layout";
import { TokenIcon } from "../components/TokenIcon";
import { useAuth } from "../contexts/useAuth";
import { useToast } from "../contexts/ToastContext";
import {
  api,
  type Activity,
  type CampaignResult,
  type Deposit,
  type DepositClaim,
  type Me,
  type PaymentRequest,
  type Requests,
  type Reserve,
  type SendResult,
} from "../lib/api";
import { ASSET_LABEL, counterparty, dayKey, dayLabel, money, parseHandles, timeAgo } from "../lib/format";

const TABS = [
  { id: "activity", label: "Activity", icon: <ActivityIcon size={19} /> },
  { id: "send", label: "Send", icon: <Send size={18} /> },
  { id: "deposit", label: "Receive", icon: <ArrowDownToLine size={19} /> },
  { id: "requests", label: "Requests", icon: <HandCoins size={19} /> },
  { id: "campaign", label: "Pay many", icon: <Sparkles size={18} /> },
] as const;

/** Copyable pay page link: the shareable half of "your handle is your wallet". */
function PayLink({ handle }: { handle: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/account/${handle.replace(/^@/, "")}`);
      setCopied(true);
      toast("success", "Pay link copied. Share it anywhere.");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("error", "Couldn't reach the clipboard.");
    }
  }

  return (
    <button onClick={copy} className="btn btn-dim btn-sm shrink-0">
      {copied ? <Check size={14} /> : <Link2 size={14} />}
      {copied ? "Copied" : "Pay link"}
    </button>
  );
}

/** The gold card: who you are and what your handle holds, front and center. */
function HeroCard({
  me,
  balances,
  onRefresh,
  refreshing,
}: {
  me: Me;
  balances: Record<string, number>;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const cc = balances.CC ?? 0;
  return (
    <section className="chunk-gold p-6 sm:p-7">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <Avatar me={me} size={46} />
          <div className="min-w-0 leading-tight">
            <p className="eyebrow">Private wallet · Canton</p>
            <h1 className="mt-0.5 break-words font-display text-2xl font-bold tracking-tight">
              {me.handle}
            </h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh balances"
            title="Refresh"
            className="grid h-8 w-8 place-items-center rounded-full border-2 border-pen/25 bg-white/30 text-pen transition hover:bg-white/55 disabled:opacity-60"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          </button>
          <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-pen/25 bg-white/30 px-3 py-1 text-xs font-bold">
            <Lock size={11} /> Only you
          </span>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap items-end justify-between gap-5">
        <div className="flex items-center gap-4">
          <TokenIcon asset="CC" size={46} />
          <div className="leading-none">
            <p className="num text-[clamp(2.5rem,7vw,3.4rem)] font-bold tracking-tight">{money(cc)}</p>
            <p className="mt-2 text-sm font-semibold text-pen/60">Canton Coin</p>
          </div>
        </div>
        <div className="flex gap-2.5">
          <Link to="/dashboard/send" className="btn btn-dim btn-sm">
            <ArrowUpRight size={15} /> Send
          </Link>
          <PayLink handle={me.handle} />
        </div>
      </div>
    </section>
  );
}

function AssetPicker({
  assets,
  value,
  onChange,
}: {
  assets: string[];
  value: string;
  onChange: (a: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {assets.map((a) => (
        <button
          type="button"
          key={a}
          onClick={() => onChange(a)}
          className={`chip ${a === value ? "chip-on" : ""}`}
          aria-pressed={a === value}
        >
          <TokenIcon asset={a} size={20} />
          {ASSET_LABEL[a] ?? a}
        </button>
      ))}
    </div>
  );
}

function TokenGrid({
  assets,
  balances,
  reserve,
}: {
  assets: string[];
  balances: Record<string, number>;
  reserve: Reserve | null;
}) {
  const empty = assets.every((a) => !balances[a]);
  return (
    <section className="chunk p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-lg font-bold">Balances</p>
        <span className="flex items-center gap-1.5 text-xs font-semibold text-pen/50">
          <Lock size={12} /> Private on Canton
        </span>
      </div>

      {/* Two-up when the card is full-width, a single list in the side
          column: the amounts stay big either way. */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {assets.map((asset, i) => {
          const amount = balances[asset] ?? 0;
          return (
            <div
              key={asset}
              className="animate-rise flex items-center gap-3 rounded-xl border-2 border-pen bg-card-bright p-4"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <TokenIcon asset={asset} size={36} />
              <div className="min-w-0 leading-tight">
                <p className="text-sm font-bold">{ASSET_LABEL[asset] ?? asset}</p>
              </div>
              <span
                className={`num ml-auto text-2xl font-bold ${amount === 0 ? "text-pen/30" : ""}`}
              >
                {money(amount)}
              </span>
            </div>
          );
        })}
      </div>

      {empty && (
        <p className="mt-4 text-[13px] font-medium text-pen/50">
          Your wallet fills the moment someone sends you something.
        </p>
      )}

      {reserve?.active && reserve.holdings.some((h) => h.amount > 0) && (
        <p className="mt-4 flex items-center gap-2.5 border-t-2 border-pen/10 pt-4 text-[13px] font-medium text-pen/60">
          <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-gold-deep" />
          <span>
            Backed by real tokens at your own address on {reserve.network}:{" "}
            <span className="num font-bold text-pen/85">
              {reserve.holdings
                .filter((h) => h.amount > 0)
                .map((h) => `${money(h.amount)} ${ASSET_LABEL[h.asset] ?? h.asset}`)
                .join(" · ")}
            </span>{" "}
            on ledger · verified {timeAgo(reserve.asOf)}
          </span>
        </p>
      )}
    </section>
  );
}

/** One line in the feed: direction, amount, who, and when. Links to its
 *  receipt when the payment has an id. */
function ActivityRow({ e }: { e: Activity }) {
  const inbound = e.direction === "in";
  const row = (
    <>
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border-2 border-pen ${
          inbound ? "bg-[#e5f2d3] text-[#2f6d33]" : "bg-card-bright text-pen/60"
        }`}
      >
        {inbound ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
      </span>

      <TokenIcon asset={e.asset} size={28} />

      <div className="min-w-0 flex-1 leading-snug">
        <p className="flex items-baseline gap-2">
          <span className="num text-[15px] font-bold">
            {inbound ? "+" : "−"}
            {money(e.amount)}
          </span>
          <span className="text-[13px] font-semibold text-pen/50">
            {ASSET_LABEL[e.asset] ?? e.asset}
          </span>
          {!inbound && e.onboarded && (
            <span className="text-xs font-bold text-gold-ink">new wallet</span>
          )}
        </p>
        <p className="truncate text-[13px] font-medium text-pen/50">
          {inbound ? `from ${counterparty(e.from)}` : `to ${counterparty(e.to)}`}
          {e.memo ? ` · ${e.memo}` : ""}
        </p>
      </div>

      <span className="shrink-0 text-xs font-semibold text-pen/40">{timeAgo(e.ts)}</span>
    </>
  );

  const tint = inbound ? "bg-[#f4ecd7]" : "";
  return (
    <li className="border-b-2 border-pen/10 last:border-0">
      {e.id ? (
        <Link
          to={`/tx/${e.id}`}
          className={`flex items-center gap-3.5 px-5 py-4 transition hover:bg-pen/[0.06] ${tint}`}
        >
          {row}
        </Link>
      ) : (
        <div className={`flex items-center gap-3.5 px-5 py-4 ${tint}`}>{row}</div>
      )}
    </li>
  );
}

const FEED_PAGE = 12;
const DIR_FILTERS = [
  ["all", "All"],
  ["out", "Sent"],
  ["in", "Received"],
] as const;

function ActivityFeed({ entries }: { entries: Activity[] }) {
  const [query, setQuery] = useState("");
  const [dir, setDir] = useState<"all" | "in" | "out">("all");
  const [shown, setShown] = useState(FEED_PAGE);

  // Narrowing the list resets how much of it we reveal, so a filtered result
  // never starts already truncated behind a "show more".
  useEffect(() => setShown(FEED_PAGE), [query, dir]);

  if (!entries.length) {
    return (
      <div className="chunk p-10 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border-2 border-pen bg-card-bright text-pen/45">
          <Inbox size={20} />
        </span>
        <p className="mt-4 font-bold">No payments yet.</p>
        <p className="mt-1 text-sm font-medium text-pen/55">Send one and it shows up here.</p>
      </div>
    );
  }

  const needle = query.trim().toLowerCase();
  const matches = entries
    .filter((e) => {
      if (dir !== "all" && e.direction !== dir) return false;
      if (!needle) return true;
      const who = (e.direction === "in" ? e.from : e.to) ?? "";
      return who.toLowerCase().includes(needle) || (e.memo ?? "").toLowerCase().includes(needle);
    })
    // Newest first, defensively — grouping below assumes descending order.
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  const visible = matches.slice(0, shown);
  const remaining = matches.length - visible.length;

  // Group the visible rows into contiguous day buckets (Today, Yesterday, …).
  const groups: { key: string; label: string; items: Activity[] }[] = [];
  for (const e of visible) {
    const key = dayKey(e.ts);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(e);
    else groups.push({ key, label: dayLabel(e.ts), items: [e] });
  }

  // Search and filters only earn their space once there's enough to sift.
  const showControls = entries.length > 6;

  return (
    <div className="chunk overflow-hidden">
      {showControls && (
        <div className="flex flex-col gap-3 border-b-2 border-pen/10 p-3.5">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pen/40"
            />
            <input
              type="text"
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              placeholder="Search by name or note"
              aria-label="Search payments"
              className="field !h-11 pl-10 text-sm"
            />
          </div>
          <div className="flex gap-2">
            {DIR_FILTERS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setDir(id)}
                aria-pressed={dir === id}
                className={`chip !h-9 !px-3.5 text-[13px] ${dir === id ? "chip-on" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {matches.length === 0 ? (
        <div className="p-10 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border-2 border-pen bg-card-bright text-pen/45">
            <Search size={19} />
          </span>
          <p className="mt-4 font-bold">Nothing matches that.</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setDir("all");
            }}
            className="mt-3 text-sm font-bold text-gold-ink underline-offset-2 hover:underline"
          >
            Clear search and filters
          </button>
        </div>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.key}>
              <p className="border-b-2 border-pen/10 bg-pen/[0.03] px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-pen/45">
                {g.label}
              </p>
              <ul>
                {g.items.map((e) => (
                  <ActivityRow key={e.id ?? `${e.ts}-${e.to}`} e={e} />
                ))}
              </ul>
            </section>
          ))}
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setShown((n) => n + FEED_PAGE)}
              className="flex w-full items-center justify-center gap-2 border-t-2 border-pen/10 px-5 py-3.5 text-sm font-bold text-pen/70 transition hover:bg-pen/[0.06]"
            >
              Show {Math.min(FEED_PAGE, remaining)} more
              <ChevronDown size={15} />
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="shake flex items-start gap-2.5 rounded-xl border-2 border-pen bg-[#fadfe3] px-4 py-3 text-sm font-semibold text-[#7c1d2c]">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function ResultNote({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="animate-rise rounded-xl border-2 border-pen bg-[#f7ecd2] p-5">
      <p className="flex items-center gap-2 font-bold text-gold-ink">
        <CheckCircle2 size={16} /> {title}
      </p>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

function SendPanel({
  assets,
  presetTo,
  onDone,
}: {
  assets: string[];
  presetTo?: string;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"handle" | "address">("handle");
  const [to, setTo] = useState(presetTo ?? "");
  const [addr, setAddr] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState(assets[0] ?? "CC");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const toast = useToast();

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setError(null);
    const value = Number(amount);

    // Each mode resolves the recipient a different way: a handle is a name we
    // look up, an address is the Canton party id itself. A party id always has
    // the "::" namespace separator, so we can sanity-check it before the ledger.
    let recipient: string;
    if (mode === "address") {
      recipient = addr.trim();
      if (!recipient) return setError("Paste the Canton address you're sending to.");
      if (!recipient.includes("::")) return setError("That doesn't look like a Canton address.");
    } else {
      recipient = to.replace(/^@+/, "").trim();
      if (!recipient) return setError("Who are you sending to?");
    }
    if (!(value > 0)) return setError("Enter an amount greater than zero.");

    setBusy(true);
    try {
      const res = await api.send({ to: recipient, asset, amount: value, memo });
      setResult(res);
      toast("success", `Sent ${money(res.amount)} ${ASSET_LABEL[res.asset] ?? res.asset} to ${res.to}`);
      setTo("");
      setAddr("");
      setAmount("");
      setMemo("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through. Nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="chunk grid min-w-0 gap-5 p-6 sm:p-7">
      <div className="grid min-w-0 gap-2.5">
        <span className="label">To</span>

        {/* One recipient, two ways to name them. A segmented switch keeps the
            form to a single input that morphs, instead of two rival fields. */}
        <div className="seg" role="tablist" aria-label="Send to a handle or a Canton address">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "handle"}
            className={`seg-btn ${mode === "handle" ? "seg-on" : ""}`}
            onClick={() => {
              setMode("handle");
              setError(null);
            }}
          >
            <AtSign size={15} /> Handle
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "address"}
            className={`seg-btn ${mode === "address" ? "seg-on" : ""}`}
            onClick={() => {
              setMode("address");
              setError(null);
            }}
          >
            <Fingerprint size={15} /> Address
          </button>
        </div>

        {mode === "handle" ? (
          <>
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute left-4 font-semibold text-pen/40">@</span>
              <input
                id="to"
                className="field pl-9"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="handle"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <p className="text-[13px] font-medium text-pen/50">
              They don't need an account. If they've never used Selkie, this creates their wallet.
            </p>
          </>
        ) : (
          <>
            <textarea
              id="addr"
              className="field num min-h-[3.5rem] resize-none break-all py-2.5 text-sm leading-snug"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="party::fingerprint"
              autoComplete="off"
              spellCheck={false}
              rows={2}
            />
            <p className="text-[13px] font-medium text-pen/50">
              Paste a Selkie Canton address. It settles straight to that wallet on-ledger, private
              and instant.
            </p>
          </>
        )}
      </div>

      <div className="grid gap-2">
        <label className="label" htmlFor="amount">
          Amount
        </label>
        <input
          id="amount"
          className="field num"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          autoComplete="off"
        />
      </div>

      <div className="grid gap-2.5">
        <span className="label">Asset</span>
        <AssetPicker assets={assets} value={asset} onChange={setAsset} />
      </div>

      <div className="grid gap-2">
        <label className="label" htmlFor="memo">
          Note <span className="font-medium text-pen/40">(optional)</span>
        </label>
        <input
          id="memo"
          className="field"
          value={memo}
          maxLength={140}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="what's it for"
          autoComplete="off"
        />
      </div>

      <button className="btn btn-gold w-full" disabled={busy} type="submit">
        {busy ? "Sending…" : "Send payment"}
      </button>

      {error && <ErrorNote key={error}>{error}</ErrorNote>}

      {result && (
        <ResultNote title="Payment settled on Canton">
          <p className="break-words font-medium">
            <span className="num font-bold text-gold-ink">
              {money(result.amount)} {ASSET_LABEL[result.asset] ?? result.asset}
            </span>{" "}
            is now with <strong className="break-all">{result.to}</strong>.
          </p>
          <p className="mt-2 break-words text-sm font-medium text-pen/65">
            {result.onboarded
              ? `${result.to} had no wallet. Selkie made one, and the money is already theirs.`
              : "The amount stays between you two."}
          </p>
        </ResultNote>
      )}
    </form>
  );
}

/** A long ledger string you are meant to copy, never to retype. */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast("success", `${label} copied.`);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("error", "Couldn't reach the clipboard.");
    }
  }

  return (
    <div className="grid gap-2">
      <span className="label">{label}</span>
      {/* A party id is 70 characters. It wraps rather than truncates: a
          half-shown address is worse than a two-line one, and letting it
          break keeps it from widening the whole column. */}
      <div className="flex items-start gap-2.5">
        <code className="num min-w-0 flex-1 break-all rounded-xl border-2 border-pen bg-card-bright px-4 py-3 text-[13px] font-semibold leading-relaxed">
          {value}
        </code>
        <button type="button" onClick={copy} className="btn btn-dim btn-sm shrink-0">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/** Your two ways to get paid: your handle, and the address behind it. */
function ReceiveCard({ me }: { me: Me }) {
  return (
    <section className="chunk p-6 sm:p-7">
      <div className="flex items-center gap-3.5">
        <Avatar me={me} size={44} />
        <div className="leading-tight">
          <p className="eyebrow">Get paid</p>
          <h2 className="mt-0.5 font-display text-2xl font-bold tracking-tight">{me.handle}</h2>
        </div>
      </div>
      <p className="mt-4 text-sm font-medium text-pen/60">
        On Selkie, people pay you by your handle — nothing to paste, no app to install. Share your
        handle, or your Canton address for wallets elsewhere on the network.
      </p>
      <div className="mt-5 grid gap-4">
        <CopyField label="Your handle" value={me.handle} />
        {me.address && <CopyField label="Your Canton address" value={me.address} />}
      </div>
      <p className="mt-4 flex items-start gap-2.5 border-t-2 border-pen/10 pt-4 text-[13px] font-medium text-pen/55">
        <Lock size={13} className="mt-0.5 shrink-0" />
        <span>
          Your handle is the instant path inside Selkie. The address is the on-ledger identity behind
          it — the same wallet, shown the way the rest of Canton addresses it.
        </span>
      </p>
    </section>
  );
}

/** Sum claimed transfers per asset into a human line, e.g. "100 CC and 0.1 cBTC". */
function summarizeClaim(claimed: DepositClaim["claimed"]): string {
  const byAsset = new Map<string, number>();
  for (const c of claimed) byAsset.set(c.asset, (byAsset.get(c.asset) ?? 0) + c.amount);
  return [...byAsset].map(([a, n]) => `${money(n)} ${ASSET_LABEL[a] ?? a}`).join(" and ");
}

function DepositPanel({ me, onDone }: { me: Me; onDone: () => void }) {
  const [info, setInfo] = useState<Deposit | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DepositClaim | null>(null);
  const toast = useToast();

  const load = useCallback(
    () =>
      api
        .deposit()
        .then((d) => {
          setInfo(d);
          return d;
        })
        .catch(() => {
          const off: Deposit = { active: false };
          setInfo(off);
          return off;
        }),
    [],
  );

  const claim = useCallback(
    async (silent = false) => {
      setBusy(true);
      try {
        const res = await api.claimDeposits();
        setResult(res);
        if (res.claimed.length) {
          toast("success", `${summarizeClaim(res.claimed)} landed in your wallet.`);
          onDone();
          await load();
        } else if (!silent) {
          toast("error", "Nothing waiting for you yet.");
        }
      } catch (err) {
        if (!silent) toast("error", err instanceof Error ? err.message : "Couldn't reach the ledger.");
      } finally {
        setBusy(false);
      }
    },
    [load, onDone, toast],
  );

  // Open the tab, read the deposit config, and quietly accept anything already
  // sitting at your address so a transfer just shows up.
  useEffect(() => {
    let alive = true;
    void load().then((d) => {
      if (alive && d.active && d.pending.length > 0) void claim(true);
    });
    return () => {
      alive = false;
    };
    // load and claim are stable; run this once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!info)
    return (
      <div className="grid gap-6">
        <ReceiveCard me={me} />
        <div className="chunk p-10 text-center font-bold text-pen/50">Loading…</div>
      </div>
    );

  const address = info.active ? info.address : (me.address ?? null);
  const waitingByAsset = new Map<string, number>();
  if (info.active) {
    for (const p of info.pending) waitingByAsset.set(p.asset, (waitingByAsset.get(p.asset) ?? 0) + p.amount);
  }
  const waiting = [...waitingByAsset];
  const tokenList = info.active
    ? info.assets.map((a) => ASSET_LABEL[a] ?? a).join(" or ")
    : "";

  return (
    <div className="grid gap-6">
      <ReceiveCard me={me} />

      {/* One personal Canton party receives every token, and Selkie accepts it
          for you. No tags, no separate addresses: the party is the address. */}
      {info.active && address && (
        <section className="chunk p-6 sm:p-7">
          <p className="font-display text-lg font-bold">Fund your wallet</p>
          <p className="mt-2 text-sm font-medium text-pen/60">
            Send {tokenList} from the Canton Coin Wallet, or any Canton wallet, to your address
            below. It arrives at your own party on {info.network} and Selkie accepts it into your
            balance for you.
          </p>
          <div className="mt-5">
            <CopyField label={`Your Canton address on ${info.network}`} value={address} />
          </div>

          {waiting.length > 0 && (
            <p className="mt-4 flex items-start gap-2.5 rounded-xl border-2 border-pen bg-[#eef6ec] px-4 py-3 text-[13px] font-semibold text-[#215c2f]">
              <ArrowDownLeft size={14} className="mt-0.5 shrink-0" />
              <span>
                <span className="num font-bold">
                  {waiting.map(([a, n]) => `${money(n)} ${ASSET_LABEL[a] ?? a}`).join(" · ")}
                </span>{" "}
                just arrived and is being accepted into your wallet…
              </span>
            </p>
          )}

          <p className="mt-4 flex items-start gap-2.5 border-t-2 border-pen/10 pt-4 text-[13px] font-medium text-pen/55">
            <Lock size={13} className="mt-0.5 shrink-0" />
            <span>
              One address for every token. A Canton transfer waits on the ledger until it is
              accepted; Selkie does that for you the moment you open this page, or when you tap below.
            </span>
          </p>
        </section>
      )}

      {info.active && (
        <section className="chunk p-6 sm:p-7">
          <p className="font-display text-lg font-bold">Already sent something?</p>
          <p className="mt-1 text-[13px] font-medium text-pen/55">
            This reads the ledger for transfers waiting at your address and accepts them.
          </p>
          <button onClick={() => claim()} disabled={busy} className="btn btn-gold mt-4 w-full">
            {busy ? "Checking the ledger…" : "Check for deposits"}
          </button>

          {result && (
            <div className="mt-5">
              {result.claimed.length ? (
                <ResultNote title="Deposit settled on Canton">
                  <p className="font-medium">
                    <span className="num font-bold text-gold-ink">
                      {summarizeClaim(result.claimed)}
                    </span>{" "}
                    is now in your wallet.
                  </p>
                </ResultNote>
              ) : (
                <p className="text-sm font-medium text-pen/55">
                  Nothing waiting for you yet. A transfer can take a moment to reach the participant.
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** One open ask, with the buttons that end it. */
function RequestRow({
  req,
  side,
  onAnswer,
}: {
  req: PaymentRequest;
  side: "incoming" | "outgoing";
  onAnswer: (cid: string, action: "approve" | "decline" | "cancel") => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function answer(action: "approve" | "decline" | "cancel") {
    setBusy(action);
    try {
      await onAnswer(req.cid, action);
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="rounded-xl border-2 border-pen bg-card-bright p-4">
      <div className="flex items-center gap-3">
        <TokenIcon asset={req.asset} size={32} />
        <div className="min-w-0 flex-1 leading-snug">
          <p className="flex items-baseline gap-2">
            <span className="num text-[15px] font-bold">{money(req.amount)}</span>
            <span className="text-[13px] font-semibold text-pen/50">
              {ASSET_LABEL[req.asset] ?? req.asset}
            </span>
          </p>
          <p className="truncate text-[13px] font-medium text-pen/55">
            {side === "incoming" ? `${req.from} asked you` : `you asked ${req.to}`}
            {req.memo ? ` · ${req.memo}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2.5">
        {side === "incoming" ? (
          <>
            <button
              className="btn btn-gold btn-sm"
              disabled={busy !== null}
              onClick={() => answer("approve")}
            >
              {busy === "approve" ? "Paying…" : "Pay"}
            </button>
            <button
              className="btn btn-dim btn-sm"
              disabled={busy !== null}
              onClick={() => answer("decline")}
            >
              {busy === "decline" ? "Declining…" : "Decline"}
            </button>
          </>
        ) : (
          <button
            className="btn btn-dim btn-sm"
            disabled={busy !== null}
            onClick={() => answer("cancel")}
          >
            {busy === "cancel" ? "Withdrawing…" : "Withdraw"}
          </button>
        )}
      </div>
    </li>
  );
}

function RequestsPanel({
  assets,
  requests,
  onDone,
}: {
  assets: string[];
  requests: Requests;
  onDone: () => void;
}) {
  const [from, setFrom] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState(assets[0] ?? "CC");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setError(null);
    const value = Number(amount);
    if (!from.trim()) return setError("Who are you asking?");
    if (!(value > 0)) return setError("Enter an amount greater than zero.");

    setBusy(true);
    try {
      const res = await api.askFor({
        from: from.replace(/^@+/, "").trim(),
        asset,
        amount: value,
        memo,
      });
      toast("success", `Asked ${res.to} for ${money(res.amount)} ${ASSET_LABEL[res.asset] ?? res.asset}`);
      setFrom("");
      setAmount("");
      setMemo("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through. Nothing was asked.");
    } finally {
      setBusy(false);
    }
  }

  async function answer(cid: string, action: "approve" | "decline" | "cancel") {
    try {
      await api.answerRequest({ cid, action });
      toast(
        "success",
        action === "approve"
          ? "Paid. Settled on Canton."
          : action === "decline"
            ? "Declined. No money moved."
            : "Request withdrawn.",
      );
      onDone();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "That didn't go through.");
    }
  }

  const { incoming, outgoing } = requests;

  return (
    <div className="grid gap-6">
      {incoming.length > 0 && (
        <section className="chunk p-5 sm:p-6">
          <p className="font-display text-lg font-bold">Waiting on you</p>
          <p className="mt-1 text-[13px] font-medium text-pen/55">
            Nothing has moved. It only moves when you tap Pay.
          </p>
          <ul className="mt-4 grid gap-3">
            {incoming.map((r) => (
              <RequestRow key={r.cid} req={r} side="incoming" onAnswer={answer} />
            ))}
          </ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="chunk p-5 sm:p-6">
          <p className="font-display text-lg font-bold">You're waiting on</p>
          <ul className="mt-4 grid gap-3">
            {outgoing.map((r) => (
              <RequestRow key={r.cid} req={r} side="outgoing" onAnswer={answer} />
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={submit} className="chunk grid gap-5 p-6 sm:p-7">
        <div>
          <p className="font-display text-lg font-bold">Ask for money</p>
          <p className="mt-1 text-[13px] font-medium text-pen/55">
            They get a request, not a charge. Only their approval moves anything.
          </p>
        </div>

        <div className="grid gap-2">
          <label className="label" htmlFor="ask-from">
            From
          </label>
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-4 font-semibold text-pen/40">@</span>
            <input
              id="ask-from"
              className="field pl-9"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="handle"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <label className="label" htmlFor="ask-amount">
            Amount
          </label>
          <input
            id="ask-amount"
            className="field num"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoComplete="off"
          />
        </div>

        <div className="grid gap-2.5">
          <span className="label">Asset</span>
          <AssetPicker assets={assets} value={asset} onChange={setAsset} />
        </div>

        <div className="grid gap-2">
          <label className="label" htmlFor="ask-memo">
            Note <span className="font-medium text-pen/40">(optional)</span>
          </label>
          <input
            id="ask-memo"
            className="field"
            value={memo}
            maxLength={140}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="what's it for"
            autoComplete="off"
          />
        </div>

        <button className="btn btn-gold w-full" disabled={busy} type="submit">
          {busy ? "Asking…" : "Send request"}
        </button>

        {error && <ErrorNote key={error}>{error}</ErrorNote>}
      </form>
    </div>
  );
}

function CampaignPanel({ assets, onDone }: { assets: string[]; onDone: () => void }) {
  const [raw, setRaw] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState(assets[0] ?? "CC");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CampaignResult | null>(null);
  const toast = useToast();
  const winners = parseHandles(raw);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setError(null);
    const value = Number(amount);
    if (!winners.length) return setError("Add at least one winner.");
    if (!(value > 0)) return setError("Enter an amount greater than zero.");

    setBusy(true);
    try {
      const res = await api.campaign({ winners, asset, amountEach: value, memo: memo || "reward" });
      setResult(res);
      toast(
        res.failed.length ? "error" : "success",
        res.failed.length
          ? `Paid ${res.paid} of ${res.paid + res.failed.length} winners`
          : `Paid all ${res.paid} winners. Nothing left unclaimed.`,
      );
      setRaw("");
      setAmount("");
      setMemo("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through. Nobody was paid.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="chunk grid gap-5 p-6 sm:p-7">
      <div className="grid gap-2">
        <label className="label" htmlFor="winners">
          Winners
        </label>
        <textarea
          id="winners"
          className="field min-h-[6rem] resize-y leading-relaxed"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={"@ada @bayo @chidi\none per line, or separated by spaces"}
        />
        <p className="text-[13px] font-medium text-pen/50">
          <span className="num font-bold text-pen/80">{winners.length}</span> handles. Each one gets
          the amount below.
        </p>
      </div>

      <div className="grid gap-2">
        <label className="label" htmlFor="each">
          Amount each
        </label>
        <input
          id="each"
          className="field num"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          autoComplete="off"
        />
      </div>

      <div className="grid gap-2.5">
        <span className="label">Asset</span>
        <AssetPicker assets={assets} value={asset} onChange={setAsset} />
      </div>

      <div className="grid gap-2">
        <label className="label" htmlFor="campaign-memo">
          Note <span className="font-medium text-pen/40">(optional)</span>
        </label>
        <input
          id="campaign-memo"
          className="field"
          value={memo}
          maxLength={140}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="meme contest winners"
          autoComplete="off"
        />
      </div>

      <button className="btn btn-gold w-full" disabled={busy} type="submit">
        {busy
          ? `Paying ${winners.length}…`
          : winners.length
            ? `Pay ${winners.length} ${winners.length === 1 ? "winner" : "winners"}`
            : "Pay everyone"}
      </button>

      {error && <ErrorNote key={error}>{error}</ErrorNote>}

      {result && (
        <ResultNote title="Campaign settled on Canton">
          <div className="flex flex-wrap gap-10">
            {(
              [
                ["paid", result.paid],
                ["onboarded", result.onboarded],
                ["unclaimed", result.failed.length],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="grid gap-1">
                <span className="num text-4xl font-bold leading-none text-gold-ink">{value}</span>
                <span className="text-[11px] font-bold uppercase tracking-wider text-pen/50">
                  {label}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm font-medium text-pen/65">
            {result.failed.length
              ? result.failed.map((f) => `${f.handle}: ${f.error}`).join(" · ")
              : "Every winner was paid. Nobody had to claim anything."}
          </p>
        </ResultNote>
      )}
    </form>
  );
}

export function Dashboard() {
  const { me, loading } = useAuth();
  const { tab } = useParams<{ tab: string }>();
  const [search] = useSearchParams();
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [entries, setEntries] = useState<Activity[]>([]);
  const [reserve, setReserve] = useState<Reserve | null>(null);
  const [requests, setRequests] = useState<Requests>({ incoming: [], outgoing: [] });

  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!me) return;
    // The reserve is nice-to-have context; a hiccup there must not take the
    // wallet down with it.
    const [b, h, q, r] = await Promise.all([
      api.balance(),
      api.history(),
      api.requests(),
      api.reserve().catch(() => null),
    ]);
    setBalances(b.balances);
    setEntries(h.entries);
    setRequests(q);
    setReserve(r);
  }, [me]);

  // The tap-to-refresh icon on the hero: same reload, with a spin so the tap
  // is felt. Beats a full page reload, which throws the whole app away.
  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Money can land while you're just looking at your balance: the server sweeps
  // incoming Canton Coin on its own, so poll quietly to let a deposit appear
  // without a tap. Pause while the tab is hidden, and catch up when it's shown
  // again, so a backgrounded wallet isn't hammering the ledger.
  useEffect(() => {
    if (!me) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = window.setInterval(tick, 8_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [me, refresh]);

  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/" replace />;
  if (!tab || !TABS.some((t) => t.id === tab)) return <Navigate to="/dashboard/activity" replace />;

  const presetTo = search.get("to") ?? undefined;

  return (
    <>
      <Header />
      <main className="pb-24 pt-8">
        <Shell wide>
          <div className="flex flex-col gap-6 lg:flex-row lg:justify-center lg:gap-7 lg:pt-3">
            {/* The floating rail: one square per thing you can do. */}
            <nav
              aria-label="Wallet sections"
              className="flex gap-3 lg:sticky lg:top-24 lg:h-fit lg:flex-col"
            >
              {TABS.map((t) => (
                <NavLink
                  key={t.id}
                  to={`/dashboard/${t.id}`}
                  title={t.label}
                  aria-label={t.label}
                  className={({ isActive }) => `rail-sq ${isActive ? "rail-on" : ""}`}
                >
                  {t.icon}
                  {t.id === "requests" && requests.incoming.length > 0 && (
                    <span className="rail-badge">{requests.incoming.length}</span>
                  )}
                </NavLink>
              ))}
            </nav>

            <div className="w-full min-w-0 lg:max-w-4xl">
              <HeroCard me={me} balances={balances} onRefresh={doRefresh} refreshing={refreshing} />

              {/* Below the hero the wallet splits: what you hold on the left,
                  what you're doing on the right. A rail click lands its panel
                  on screen immediately — no scrolling to find it. On phones
                  the panel comes first for the same reason. */}
              <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
                {/* Keyed by tab so each switch gets the same soft entrance. */}
                <div className="min-w-0 animate-rise" key={tab}>
                  {tab === "activity" && <ActivityFeed entries={entries} />}
                  {tab === "send" && (
                    <SendPanel assets={me.assets} presetTo={presetTo} onDone={refresh} />
                  )}
                  {tab === "deposit" && <DepositPanel me={me} onDone={refresh} />}
                  {tab === "requests" && (
                    <RequestsPanel assets={me.assets} requests={requests} onDone={refresh} />
                  )}
                  {tab === "campaign" && <CampaignPanel assets={me.assets} onDone={refresh} />}
                </div>
                <div className="min-w-0 lg:sticky lg:top-24 lg:order-first">
                  <TokenGrid assets={me.assets} balances={balances} reserve={reserve} />
                </div>
              </div>
            </div>
          </div>
        </Shell>
      </main>
    </>
  );
}
