"use client";

import { useState } from "react";
import { ArrowLeft, Check, Clock, Loader2 } from "lucide-react";
import { Avatar } from "@/components/Layout";
import { Sheet } from "@/components/Sheet";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, api, type Recipient, type SendResult } from "@/lib/api";
import { DOLLAR, usd } from "@/lib/format";

type Step = "compose" | "confirm" | "done";

const QUICK = ["5", "10", "25"];

/**
 * Sending money, in two steps and never one.
 *
 * The confirm step exists because a mistyped handle is the most common way
 * people lose money in an app like this, and the only defence that works is
 * showing a face and a name before the money moves. It is worth the extra tap.
 */
export function SendSheet({
  balance,
  onClose,
  onSent,
}: {
  /** What they can actually spend, as a decimal string. */
  balance: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<Step>("compose");
  const [handle, setHandle] = useState("");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cleanHandle = handle.trim().replace(/^@+/, "").toLowerCase();
  const value = Number(amount);
  const tooMuch = value > Number(balance);
  const canContinue = cleanHandle.length > 0 && value > 0 && !tooMuch;

  /** Digits and at most two decimals. Money is typed, not computed. */
  const onAmount = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    const [whole, decimals] = cleaned.split(".");
    setAmount(decimals === undefined ? whole : `${whole}.${decimals.slice(0, 2)}`);
  };

  const toConfirm = async () => {
    setChecking(true);
    setError(null);
    try {
      const found = await api.recipient(cleanHandle);
      setRecipient(found);
      setStep("confirm");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We could not look that handle up.");
    } finally {
      setChecking(false);
    }
  };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const sent = await api.send({ to: cleanHandle, amount, asset: DOLLAR });
      setResult(sent);
      setStep("done");
      onSent();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "That did not go through.";
      setError(message);
      toast("error", message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet title="Send money" onClose={step === "done" ? undefined : onClose}>
      {step === "compose" && (
        <div>
          <p className="eyebrow">Send</p>
          <h2 className="mt-1.5 font-display text-2xl font-bold tracking-tight">Who are you paying?</h2>

          <label className="label mt-6 block" htmlFor="send-handle">
            Their X handle
          </label>
          <div className="relative mt-2">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] font-bold text-pen/40">
              @
            </span>
            <input
              id="send-handle"
              className="field pl-9"
              placeholder="amaka"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={handle.replace(/^@+/, "")}
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canContinue && void toConfirm()}
            />
          </div>

          <label className="label mt-5 block" htmlFor="send-amount">
            How much
          </label>
          <div className="relative mt-2">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] font-bold text-pen/40">
              $
            </span>
            <input
              id="send-amount"
              className="field pl-8 font-display text-lg font-bold"
              placeholder="0.00"
              inputMode="decimal"
              value={amount}
              onChange={(e) => onAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canContinue && void toConfirm()}
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            {QUICK.map((quick) => (
              <button
                key={quick}
                onClick={() => setAmount(quick)}
                className={`chip ${amount === quick ? "chip-on" : ""}`}
                type="button"
              >
                ${quick}
              </button>
            ))}
            <span className="ml-auto text-[13px] font-semibold text-pen/50">
              {usd(balance)} available
            </span>
          </div>

          {tooMuch && (
            <p className="mt-3 text-sm font-semibold text-[#a11d34]">
              That is more than you have right now.
            </p>
          )}
          {error && <p className="mt-3 text-sm font-semibold text-[#a11d34]">{error}</p>}

          <button
            onClick={() => void toConfirm()}
            disabled={!canContinue || checking}
            className="btn btn-gold mt-6 w-full"
          >
            {checking ? <Loader2 size={16} className="animate-spin" /> : null}
            {checking ? "Checking" : "Continue"}
          </button>
        </div>
      )}

      {step === "confirm" && recipient && (
        <div>
          <button
            onClick={() => setStep("compose")}
            className="flex items-center gap-1.5 text-[13px] font-bold text-pen/55 transition-colors hover:text-pen"
          >
            <ArrowLeft size={15} /> Back
          </button>

          <div className="mt-5 flex flex-col items-center text-center">
            <Avatar
              name={`@${recipient.handle.username}`}
              src={recipient.avatarUrl}
              size={64}
            />
            {recipient.displayName && (
              <p className="mt-3 font-display text-xl font-bold tracking-tight">
                {recipient.displayName}
              </p>
            )}
            <p
              className={`font-semibold text-pen/70 ${recipient.displayName ? "text-sm" : "mt-3 font-display text-xl tracking-tight text-pen"}`}
            >
              @{recipient.handle.username}
            </p>

            <p className="mt-6 font-display text-[2.75rem] font-bold leading-none tracking-tight">
              {usd(amount)}
            </p>

            {recipient.isYou ? (
              <p className="mt-4 text-sm font-semibold text-[#a11d34]">
                That is your own handle. Pick someone else.
              </p>
            ) : recipient.onSelkie ? (
              <p className="mt-4 text-[15px] leading-relaxed text-pen/65">
                They already use Selkie, so this lands straight away.
              </p>
            ) : (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-pen/[0.05] p-3 text-left text-[14px] leading-relaxed text-pen/70">
                <Clock size={16} className="mt-0.5 shrink-0" />
                <span>
                  They have not joined yet. Your money waits for them and lands the moment they
                  sign in with X. If they never do, you get it back.
                </span>
              </p>
            )}
          </div>

          {error && <p className="mt-4 text-sm font-semibold text-[#a11d34]">{error}</p>}

          <button
            onClick={() => void send()}
            disabled={sending || recipient.isYou}
            className="btn btn-gold mt-6 w-full"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : null}
            {sending ? "Sending" : `Send ${usd(amount)}`}
          </button>
        </div>
      )}

      {step === "done" && result && (
        <div className="flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full border-2 border-[#2f7d3f]/40 bg-[#2f7d3f]/12 text-[#2f7d3f]">
            {result.waitingToBeClaimed ? (
              <Clock size={24} strokeWidth={2.2} />
            ) : (
              <Check size={26} strokeWidth={2.6} />
            )}
          </span>
          <p className="mt-5 font-display text-2xl font-bold tracking-tight">
            {usd(amount)} to @{cleanHandle}
          </p>
          <p className="mt-2 text-[15px] leading-relaxed text-pen/65">{result.message}</p>
          <button onClick={onClose} className="btn btn-dark mt-7 w-full">
            Done
          </button>
        </div>
      )}
    </Sheet>
  );
}
