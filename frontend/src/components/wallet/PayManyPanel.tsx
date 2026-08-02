"use client";

import { useState, type KeyboardEvent } from "react";
import { ArrowLeft, Check, Clock, Loader2, X } from "lucide-react";
import { Avatar } from "@/components/Layout";
import { Panel, PanelHead } from "@/components/wallet/Panel";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, api, type BatchResult } from "@/lib/api";
import { DOLLAR, cleanAmount, parseHandles, usd } from "@/lib/format";

/** The server refuses more than this in one go; saying so early beats a rejection. */
const MAX = 100;

type Step = "compose" | "confirm" | "done";

/**
 * Paying a list of people the same amount each.
 *
 * The total is the number that matters, so it is on screen from the first
 * handle onward and again on the confirm step. Sending forty payments and
 * finding out at number twenty-three that the money ran out is not a mistake
 * anyone can explain afterwards, so it is checked before anything moves.
 */
export function PayManyPanel({
  balance,
  onSent,
}: {
  balance: string;
  onSent: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<Step>("compose");
  const [handles, setHandles] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const each = Number(amount);
  const total = each * handles.length;
  const tooMuch = total > Number(balance);
  const tooMany = handles.length > MAX;
  const ready = handles.length > 0 && each > 0 && !tooMuch && !tooMany;

  /** Anything typed or pasted becomes chips: spaces, commas and newlines all split. */
  const commit = (text: string) => {
    if (!text.trim()) return;
    setHandles((current) => [
      ...current,
      ...parseHandles(text)
        .map((handle) => handle.toLowerCase())
        .filter((handle) => !current.includes(handle)),
    ]);
    setDraft("");
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "," || event.key === " ") {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "") {
      setHandles((current) => current.slice(0, -1));
    }
  };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const sent = await api.payMany({
        to: handles,
        amount,
        asset: DOLLAR,
        note: note.trim() || undefined,
      });
      setResult(sent);
      setStep("done");
      onSent();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "That did not go through.";
      setError(message);
      toast("error", message);
      setStep("compose");
    } finally {
      setSending(false);
    }
  };

  if (step === "done" && result) {
    const failed = result.results.filter((row) => !row.sent);
    return (
      <Panel>
        <div className="flex flex-col items-center text-center">
          <span
            className={`grid h-16 w-16 place-items-center rounded-full border-2 ${
              failed.length === 0
                ? "border-[#2f7d3f]/40 bg-[#2f7d3f]/12 text-[#2f7d3f]"
                : "border-gold-deep/50 bg-gold/15 text-gold-ink"
            }`}
          >
            <Check size={30} strokeWidth={2.6} />
          </span>
          <p className="mt-5 font-display text-2xl font-bold tracking-tight">{result.message}</p>
          <p className="mt-2 text-[15px] text-pen/65">
            {usd(amount)} each, {usd(total)} in total.
          </p>
        </div>

        <div className="mt-6 max-h-72 overflow-y-auto rounded-2xl border-2 border-pen/15">
          {result.results.map((row) => (
            <div
              key={row.handle}
              className="flex items-center gap-3 border-t-2 border-pen/[0.07] px-4 py-2.5 first:border-t-0"
            >
              <Avatar name={row.handle} size={30} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{row.handle}</span>
              {!row.sent ? (
                <span className="flex items-center gap-1.5 text-[13px] font-bold text-[#a11d34]">
                  <X size={14} strokeWidth={2.8} /> Did not send
                </span>
              ) : row.waitingToBeClaimed ? (
                <span className="flex items-center gap-1.5 text-[13px] font-bold text-gold-ink">
                  <Clock size={14} strokeWidth={2.6} /> Waiting for them
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[13px] font-bold text-[#2f7d3f]">
                  <Check size={14} strokeWidth={2.8} /> Sent
                </span>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={() => {
            setStep("compose");
            setHandles([]);
            setAmount("");
            setNote("");
            setResult(null);
          }}
          className="btn btn-dark mt-6 w-full"
        >
          Pay another group
        </button>
      </Panel>
    );
  }

  if (step === "confirm") {
    return (
      <Panel>
        <button
          onClick={() => setStep("compose")}
          className="flex items-center gap-1.5 text-[13px] font-bold text-pen/55 transition-colors hover:text-pen"
        >
          <ArrowLeft size={15} /> Back
        </button>

        <div className="mt-5 text-center">
          <p className="eyebrow">You are about to send</p>
          <p className="mt-2 font-display text-[3rem] font-bold leading-none tracking-tight">
            {usd(total)}
          </p>
          <p className="mt-2.5 text-[15px] text-pen/65">
            {usd(amount)} each to {handles.length} {handles.length === 1 ? "person" : "people"}
          </p>
          {note.trim() && (
            <p className="mt-3 text-[15px] italic text-pen/60">“{note.trim()}”</p>
          )}
        </div>

        <div className="mt-6 max-h-64 overflow-y-auto rounded-2xl border-2 border-pen/15">
          {handles.map((handle) => (
            <div
              key={handle}
              className="flex items-center gap-3 border-t-2 border-pen/[0.07] px-4 py-2.5 first:border-t-0"
            >
              <Avatar name={`@${handle}`} size={30} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-bold">@{handle}</span>
              <span className="font-display text-[14px] font-bold tabular-nums text-pen/70">
                {usd(amount)}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-4 text-center text-[14px] leading-relaxed text-pen/60">
          Anyone here who has not joined yet gets theirs the moment they sign in with X.
        </p>

        {error && <p className="mt-4 text-sm font-semibold text-[#a11d34]">{error}</p>}

        <button
          onClick={() => void send()}
          disabled={sending}
          className="btn btn-gold mt-6 w-full"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : null}
          {sending ? "Sending" : `Send ${usd(total)}`}
        </button>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHead
        eyebrow="Pay many"
        title="Send to a whole list at once"
        blurb="Paste or type handles, pick one amount, and everyone gets the same."
      />

      <label className="label mt-6 block" htmlFor="many-handles">
        Their X handles
      </label>
      <div
        className="mt-2 flex min-h-[3rem] flex-wrap items-center gap-2 rounded-xl border-2 border-pen bg-card-bright p-2 focus-within:border-[#b8871f] focus-within:shadow-[0_0_0_4px_rgba(217,168,92,0.3)]"
        onClick={() => document.getElementById("many-handles")?.focus()}
      >
        {handles.map((handle) => (
          <span
            key={handle}
            className="flex items-center gap-1.5 rounded-lg bg-pen/[0.07] py-1 pl-1 pr-1.5 text-[13px] font-bold"
          >
            <Avatar name={`@${handle}`} size={20} />@{handle}
            <button
              onClick={() => setHandles((current) => current.filter((one) => one !== handle))}
              aria-label={`Remove @${handle}`}
              className="grid h-4 w-4 place-items-center rounded text-pen/45 transition-colors hover:bg-pen/10 hover:text-pen"
            >
              <X size={12} strokeWidth={3} />
            </button>
          </span>
        ))}
        <input
          id="many-handles"
          className="min-w-[8rem] flex-1 bg-transparent px-1.5 py-1 text-[15px] outline-none placeholder:text-pen/35"
          placeholder={handles.length === 0 ? "amaka, tunde, chidi" : "add another"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => commit(draft)}
          onPaste={(e) => {
            e.preventDefault();
            commit(e.clipboardData.getData("text"));
          }}
        />
      </div>
      <p className="mt-2 text-[13px] font-medium text-pen/50">
        {handles.length === 0
          ? "Separate them with a space or a comma."
          : `${handles.length} ${handles.length === 1 ? "person" : "people"}`}
      </p>

      <label className="label mt-5 block" htmlFor="many-amount">
        Each person gets
      </label>
      <div className="relative mt-2">
        <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 font-display text-2xl font-bold text-pen/35">
          $
        </span>
        <input
          id="many-amount"
          className="field h-[4.5rem] pl-11 font-display text-[2rem] font-bold tracking-tight"
          placeholder="0.00"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(cleanAmount(e.target.value))}
        />
      </div>

      <label className="label mt-5 block" htmlFor="many-note">
        What is it for <span className="font-medium text-pen/40">(optional)</span>
      </label>
      <input
        id="many-note"
        className="field mt-2"
        placeholder="thanks for testing"
        maxLength={80}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      {/* The total, always visible once it can be worked out. */}
      <div className="mt-6 flex items-center justify-between rounded-2xl border-2 border-pen/15 bg-pen/[0.04] p-4">
        <div>
          <p className="label">Total</p>
          <p className="mt-0.5 text-[13px] font-medium text-pen/50">
            {usd(balance)} available
          </p>
        </div>
        <p
          className={`font-display text-[1.75rem] font-bold leading-none tracking-tight tabular-nums ${
            tooMuch ? "text-[#a11d34]" : ""
          }`}
        >
          {usd(Number.isFinite(total) ? total : 0)}
        </p>
      </div>

      {tooMuch && (
        <p className="mt-3 text-sm font-semibold text-[#a11d34]">
          That comes to more than you have right now.
        </p>
      )}
      {tooMany && (
        <p className="mt-3 text-sm font-semibold text-[#a11d34]">
          That is more than {MAX} people at once. Split it into two goes.
        </p>
      )}

      <button
        onClick={() => {
          setError(null);
          setStep("confirm");
        }}
        disabled={!ready}
        className="btn btn-gold mt-6 w-full"
      >
        Review {handles.length > 0 ? `${handles.length} ${handles.length === 1 ? "payment" : "payments"}` : ""}
      </button>
    </Panel>
  );
}
