import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Clock, Lock, ShieldCheck, StickyNote, User } from "lucide-react";
import { Header, Shell, Spinner } from "../components/Layout";
import { TokenIcon } from "../components/TokenIcon";
import { api, ApiError, type Activity } from "../lib/api";
import { ASSET_LABEL, counterparty, money } from "../lib/format";

/**
 * A payment's receipt. Dugong's equivalent page is public because Sui puts
 * every transfer on a block explorer. Ours opens only for the two people in
 * the payment: everyone else gets the same answer as a stranger, "no such
 * payment", which is what sub-transaction privacy actually means.
 */
export function TransactionDetail() {
  const { id = "" } = useParams();
  const [tx, setTx] = useState<Activity | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .transaction(id)
      .then((t) => !cancelled && setTx(t))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 401)) setDenied(true);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <Spinner />;

  const inbound = tx?.direction === "in";

  return (
    <>
      <Header />
      <main className="pb-24 pt-8">
        <Shell>
          <Link to="/dashboard/activity" className="btn btn-dim btn-sm">
            <ArrowLeft size={15} /> Back
          </Link>

          {denied || !tx ? (
            <div className="chunk mx-auto mt-8 max-w-md p-8 text-center sm:p-10">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border-2 border-pen bg-card-bright text-pen/50">
                <Lock size={19} />
              </span>
              <p className="mt-4 font-display text-xl font-bold">
                This payment isn't yours to see.
              </p>
              <p className="mx-auto mt-2 max-w-sm text-sm font-medium leading-relaxed text-pen/60">
                On Canton a payment is visible only to the people in it. If you were part of this
                one, sign in with that handle.
              </p>
            </div>
          ) : (
            <div className="chunk mx-auto mt-8 max-w-lg animate-rise p-7 text-center sm:p-9">
              {/* The verdict first: which way the money went, and how much. */}
              <span
                className={`mx-auto grid h-16 w-16 place-items-center rounded-full border-2 border-pen ${
                  inbound ? "bg-[#e5f2d3] text-[#2f6d33]" : "bg-card-bright text-pen"
                }`}
              >
                {inbound ? <ArrowDownLeft size={26} /> : <ArrowUpRight size={26} />}
              </span>

              <p className="eyebrow mt-5">{inbound ? "You received" : "You sent"}</p>
              <p className="mt-2 flex items-center justify-center gap-3">
                <span className="num text-[clamp(2.6rem,9vw,3.6rem)] font-bold leading-none tracking-tight">
                  {inbound ? "+" : "−"}
                  {money(tx.amount)}
                </span>
                <TokenIcon asset={tx.asset} size={38} />
              </p>
              <p className="num mt-2 text-sm font-bold text-pen/55">
                {ASSET_LABEL[tx.asset] ?? tx.asset}
              </p>

              <dl className="mt-8 grid gap-0 rounded-xl border-2 border-pen bg-card-bright px-5 text-left text-sm">
                {[
                  [<User size={14} key="i" />, "From", counterparty(tx.from)],
                  [<User size={14} key="i" />, "To", counterparty(tx.to)],
                  [<StickyNote size={14} key="i" />, "Note", tx.memo || "none"],
                  [<Clock size={14} key="i" />, "When", new Date(tx.ts).toLocaleString()],
                  [<ShieldCheck size={14} key="i" />, "Settled on", "Canton"],
                ].map(([icon, label, value]) => (
                  <div
                    key={String(label)}
                    className="flex items-baseline justify-between gap-4 border-b-2 border-pen/10 py-3.5 last:border-0"
                  >
                    <dt className="flex shrink-0 items-center gap-2 self-center font-bold uppercase tracking-wider text-pen/55 text-[11px]">
                      {icon} {label}
                    </dt>
                    <dd className="min-w-0 break-words text-right font-semibold text-pen/85">{value}</dd>
                  </div>
                ))}
              </dl>

              {tx.onboarded && tx.direction === "out" && (
                <p className="mt-6 rounded-xl border-2 border-pen bg-[#f7ecd2] p-5 text-left text-sm font-medium leading-relaxed text-pen/80">
                  {tx.to} had no wallet before this. Selkie created one as the payment settled, so
                  there was nothing for them to claim.
                </p>
              )}

              <p className="mt-6 flex items-start justify-center gap-2 text-[13px] font-medium text-pen/50">
                <Lock size={13} className="mt-0.5 shrink-0" />
                <span className="min-w-0 break-words">
                  Only you and {counterparty(inbound ? tx.from : tx.to)} can open this page.
                </span>
              </p>
            </div>
          )}
        </Shell>
      </main>
    </>
  );
}
