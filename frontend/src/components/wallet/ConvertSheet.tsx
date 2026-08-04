"use client";

import { useEffect, useState } from "react";
import { ArrowDown, Check, Loader2 } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { TokenIcon } from "@/components/TokenIcon";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, api, newIdempotencyKey, type Money } from "@/lib/api";
import { money } from "@/lib/format";

/**
 * Converting one balance into another.
 *
 * The word is "Convert", not "swap" or "exchange": those mean different things
 * to different people, and a money app should never make anyone guess. The quote
 * refreshes as you type, because a number that appears only after you commit is
 * not a quote, it is a surprise.
 */
export function ConvertSheet({
  balances,
  onClose,
  onConverted,
}: {
  balances: Money[];
  onClose: () => void;
  onConverted: () => void;
}) {
  const toast = useToast();
  const assets = balances.map((balance) => balance.asset);
  const [from, setFrom] = useState(assets[0] ?? "USDC");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Money | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<Money | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * One key for this sheet, so a double-tap on Convert cannot convert twice.
   * The sheet closes on success, so the next conversion gets a fresh one.
   */
  const [intent] = useState(newIdempotencyKey);

  const to = assets.find((asset) => asset !== from) ?? "XLM";
  const available = balances.find((balance) => balance.asset === from)?.amount ?? "0";
  const value = Number(amount);
  const tooMuch = value > Number(available);
  const ready = value > 0 && !tooMuch;

  // Quote as they type, one request behind the last keystroke.
  useEffect(() => {
    if (!ready) {
      setQuote(null);
      return;
    }
    let live = true;
    setQuoting(true);
    const timer = setTimeout(() => {
      api
        .quote(from, to, amount)
        .then((result) => live && setQuote(result.to))
        .catch(() => live && setQuote(null))
        .finally(() => live && setQuoting(false));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [amount, from, to, ready]);

  const onAmount = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    setAmount(cleaned);
  };

  const convert = async () => {
    setWorking(true);
    setError(null);
    try {
      const result = await api.convert(from, to, amount, intent);
      setDone(result.received);
      toast("success", `Converted to ${money(result.received.amount)} ${result.received.asset}.`);
      onConverted();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "That conversion did not go through.";
      setError(message);
      toast("error", message);
    } finally {
      setWorking(false);
    }
  };

  if (done) {
    return (
      <Sheet title="Converted" onClose={onClose}>
        <div className="flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full border-2 border-[#2f7d3f]/40 bg-[#2f7d3f]/12 text-[#2f7d3f]">
            <Check size={26} strokeWidth={2.6} />
          </span>
          <p className="mt-5 flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight">
            <TokenIcon asset={done.asset} size={30} />
            {money(done.amount)} {done.asset}
          </p>
          <p className="mt-2 text-[15px] text-pen/65">It is in your wallet.</p>
          <button onClick={onClose} className="btn btn-dark mt-7 w-full">
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Convert" onClose={onClose}>
      <p className="eyebrow">Convert</p>
      <h2 className="mt-1.5 font-display text-2xl font-bold tracking-tight">
        Turn {from} into {to}
      </h2>

      <div className="mt-6 rounded-2xl border-2 border-pen/15 bg-card-bright p-4">
        <div className="flex items-center justify-between">
          <span className="label">You convert</span>
          <div className="flex gap-1.5">
            {assets.map((asset) => (
              <button
                key={asset}
                type="button"
                onClick={() => setFrom(asset)}
                className={`chip h-9 gap-1.5 pl-1.5 pr-2.5 text-[13px] ${from === asset ? "chip-on" : ""}`}
              >
                <TokenIcon asset={asset} size={20} />
                {asset}
              </button>
            ))}
          </div>
        </div>
        <input
          className="mt-2 w-full bg-transparent font-display text-3xl font-bold tracking-tight text-pen outline-none placeholder:text-pen/25"
          placeholder="0"
          inputMode="decimal"
          autoFocus
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
        />
        <p className="mt-1 text-[13px] font-semibold text-pen/50">
          {money(available)} {from} available
        </p>
      </div>

      <div className="my-2 flex justify-center text-pen/35">
        <ArrowDown size={18} strokeWidth={2.4} />
      </div>

      <div className="rounded-2xl border-2 border-pen/15 bg-pen/[0.04] p-4">
        <div className="flex items-center justify-between">
          <span className="label">You get</span>
          <span className="flex items-center gap-1.5 rounded-full border-2 border-pen/15 bg-card-bright py-1 pl-1 pr-2.5 text-[13px] font-bold">
            <TokenIcon asset={to} size={20} />
            {to}
          </span>
        </div>
        <p className="mt-1 font-display text-3xl font-bold tracking-tight">
          {quoting ? (
            <span className="text-pen/35">…</span>
          ) : quote ? (
            `${money(quote.amount)} ${quote.asset}`
          ) : (
            <span className="text-pen/25">0 {to}</span>
          )}
        </p>
        <p className="mt-1 text-[13px] text-pen/50">
          The rate comes from the network and can move slightly before it settles.
        </p>
      </div>

      {tooMuch && (
        <p className="mt-3 text-sm font-semibold text-[#a11d34]">That is more than you have.</p>
      )}
      {error && <p className="mt-3 text-sm font-semibold text-[#a11d34]">{error}</p>}

      <button
        onClick={() => void convert()}
        disabled={!ready || working || !quote}
        className="btn btn-gold mt-6 w-full"
      >
        {working ? <Loader2 size={16} className="animate-spin" /> : null}
        {working ? "Converting" : "Convert"}
      </button>
    </Sheet>
  );
}
