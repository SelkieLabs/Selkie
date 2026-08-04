"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Check, Clock, Loader2 } from "lucide-react";
import { Avatar } from "@/components/Layout";
import { PlatformLogo } from "@/components/Mark";
import { Panel, PanelHead } from "@/components/wallet/Panel";
import { PlatformToggle } from "@/components/wallet/PlatformToggle";
import { useToast } from "@/contexts/ToastContext";
import {
  ApiError,
  api,
  newIdempotencyKey,
  type ActivityEntry,
  type Recipient,
  type SendResult,
} from "@/lib/api";
import { DOLLAR, cleanAmount, usd } from "@/lib/format";
import { PLATFORM_FIELD, PLATFORM_LABEL, PLATFORM_PLACEHOLDER, type Platform } from "@/lib/platform";

type Step = "compose" | "confirm" | "done";

const QUICK = ["5", "10", "25", "50"];

interface RecentPerson {
  username: string;
  platform: Platform;
}

/**
 * People you have paid before, newest first. Typing a handle twice is a chore.
 *
 * Carries the platform, not just the name: tapping a chip has to restore the
 * person you actually paid, and @amaka on X is not @amaka on Telegram. Entries
 * from before the feed recorded a platform are skipped rather than guessed at.
 */
function recentPeople(entries: ActivityEntry[]): RecentPerson[] {
  const seen: RecentPerson[] = [];
  for (const entry of entries) {
    const handle = entry.counterpartyHandle;
    if (entry.kind !== "send" || !handle) continue;
    if (seen.some((person) => person.username === handle.username && person.platform === handle.platform)) {
      continue;
    }
    seen.push({ username: handle.username.toLowerCase(), platform: handle.platform });
    if (seen.length === 5) break;
  }
  return seen;
}

/**
 * Sending money, in two steps and never one.
 *
 * The confirm step exists because a mistyped handle is the most common way
 * people lose money in an app like this, and the only defence that works is
 * showing a face and a name before the money moves. It is worth the extra tap.
 */
export function SendPanel({
  balance,
  entries,
  onSent,
}: {
  /** What they can actually spend, as a decimal string. */
  balance: string;
  /** Recent activity, only ever read for the "people you paid" shortcuts. */
  entries: ActivityEntry[];
  onSent: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<Step>("compose");
  const [platform, setPlatform] = useState<Platform>("x");
  const [handle, setHandle] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Minted when the confirm screen opens, so every attempt at *this* payment
   * carries the same one and a double-tap cannot send twice. Starting a new
   * payment mints a new one, so paying the same person again still works.
   */
  const [intent, setIntent] = useState<string | null>(null);

  const recent = useMemo(() => recentPeople(entries), [entries]);
  const cleanHandle = handle.trim().replace(/^@+/, "").toLowerCase();
  const value = Number(amount);
  const tooMuch = value > Number(balance);
  const canContinue = cleanHandle.length > 0 && value > 0 && !tooMuch;

  const reset = () => {
    setStep("compose");
    setHandle("");
    setAmount("");
    setNote("");
    setRecipient(null);
    setResult(null);
    setError(null);
    setIntent(null);
  };

  const toConfirm = async () => {
    setChecking(true);
    setError(null);
    try {
      setRecipient(await api.recipient(cleanHandle, platform));
      setIntent(newIdempotencyKey());
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
      const sent = await api.send(
        {
          to: cleanHandle,
          amount,
          asset: DOLLAR,
          platform,
          note: note.trim() || undefined,
        },
        intent ?? undefined,
      );
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

  if (step === "done" && result) {
    return (
      <Panel>
        <div className="flex flex-col items-center py-4 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full border-2 border-[#2f7d3f]/40 bg-[#2f7d3f]/12 text-[#2f7d3f]">
            {result.waitingToBeClaimed ? (
              <Clock size={26} strokeWidth={2.2} />
            ) : (
              <Check size={30} strokeWidth={2.6} />
            )}
          </span>
          <p className="mt-5 font-display text-[2rem] font-bold leading-none tracking-tight">
            {usd(amount)}
          </p>
          <p className="mt-2 flex items-center gap-2 font-display text-lg font-bold tracking-tight text-pen/75">
            to @{cleanHandle} <PlatformLogo platform={platform} size={14} />
          </p>
          <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-pen/65">
            {result.message}
          </p>
          <button onClick={reset} className="btn btn-gold mt-7 w-full sm:w-auto sm:px-10">
            Send someone else
          </button>
        </div>
      </Panel>
    );
  }

  if (step === "confirm" && recipient) {
    return (
      <Panel>
        <button
          onClick={() => setStep("compose")}
          className="flex items-center gap-1.5 text-[13px] font-bold text-pen/55 transition-colors hover:text-pen"
        >
          <ArrowLeft size={15} /> Back
        </button>

        <div className="mt-5 flex flex-col items-center text-center">
          <Avatar name={`@${recipient.handle.username}`} src={recipient.avatarUrl} size={72} />
          {recipient.displayName && (
            <p className="mt-3.5 font-display text-xl font-bold tracking-tight">
              {recipient.displayName}
            </p>
          )}
          <p
            className={`flex items-center gap-1.5 font-semibold text-pen/70 ${
              recipient.displayName ? "text-sm" : "mt-3.5 font-display text-xl tracking-tight text-pen"
            }`}
          >
            @{recipient.handle.username}
            <PlatformLogo platform={recipient.handle.platform} size={13} />
          </p>

          <p className="mt-7 font-display text-[3rem] font-bold leading-none tracking-tight">
            {usd(amount)}
          </p>
          {note.trim() && (
            <p className="mt-3 max-w-sm text-[15px] italic leading-relaxed text-pen/60">
              “{note.trim()}”
            </p>
          )}

          {recipient.isYou ? (
            <p className="mt-5 text-sm font-semibold text-[#a11d34]">
              That is your own handle. Pick someone else.
            </p>
          ) : recipient.onSelkie ? (
            <p className="mt-5 text-[15px] leading-relaxed text-pen/65">
              They already use Selkie, so this lands straight away.
            </p>
          ) : (
            <p className="mt-5 flex max-w-md items-start gap-2.5 rounded-xl bg-pen/[0.05] p-3.5 text-left text-[14px] leading-relaxed text-pen/70">
              <Clock size={16} className="mt-0.5 shrink-0" />
              <span>
                They have not joined yet. Your money waits for them and lands the moment they sign
                in with {PLATFORM_LABEL[recipient.handle.platform]}. If they never do, you get it
                back.
              </span>
            </p>
          )}
        </div>

        {error && <p className="mt-4 text-center text-sm font-semibold text-[#a11d34]">{error}</p>}

        <button
          onClick={() => void send()}
          disabled={sending || recipient.isYou}
          className="btn btn-gold mt-7 w-full"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : null}
          {sending ? "Sending" : `Send ${usd(amount)}`}
        </button>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHead
        eyebrow="Send"
        title="Who are you paying?"
        blurb="Their handle is enough. They do not need an account, a wallet or an app."
      />

      {recent.length > 0 && (
        <div className="mt-6">
          <p className="label">Recently paid</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {recent.map((person) => {
              const active = cleanHandle === person.username && platform === person.platform;
              return (
                <button
                  key={`${person.platform}:${person.username}`}
                  type="button"
                  onClick={() => {
                    setHandle(person.username);
                    setPlatform(person.platform);
                  }}
                  className={`chip h-9 pl-1.5 pr-3 text-[13px] ${active ? "chip-on" : ""}`}
                >
                  <Avatar name={`@${person.username}`} size={24} />@{person.username}
                  <PlatformLogo platform={person.platform} size={11} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="label mt-6">Where</p>
      <PlatformToggle value={platform} onChange={setPlatform} idPrefix="send-platform" />

      <label className="label mt-5 block" htmlFor="send-handle">
        {PLATFORM_FIELD[platform]}
      </label>
      <div className="relative mt-2">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] font-bold text-pen/40">
          @
        </span>
        <input
          id="send-handle"
          className="field pl-9"
          placeholder={PLATFORM_PLACEHOLDER[platform]}
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
        <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 font-display text-2xl font-bold text-pen/35">
          $
        </span>
        <input
          id="send-amount"
          className="field h-[4.5rem] pl-11 font-display text-[2rem] font-bold tracking-tight"
          placeholder="0.00"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(cleanAmount(e.target.value))}
          onKeyDown={(e) => e.key === "Enter" && canContinue && void toConfirm()}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {QUICK.map((quick) => (
          <button
            key={quick}
            onClick={() => setAmount(quick)}
            className={`chip h-9 px-3.5 text-[13px] ${amount === quick ? "chip-on" : ""}`}
            type="button"
          >
            ${quick}
          </button>
        ))}
        <span className="ml-auto text-[13px] font-semibold text-pen/50">
          {usd(balance)} available
        </span>
      </div>

      <label className="label mt-5 block" htmlFor="send-note">
        What is it for <span className="font-medium text-pen/40">(optional)</span>
      </label>
      <input
        id="send-note"
        className="field mt-2"
        placeholder="lunch"
        maxLength={80}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && canContinue && void toConfirm()}
      />

      {tooMuch && (
        <p className="mt-4 text-sm font-semibold text-[#a11d34]">
          That is more than you have right now.
        </p>
      )}
      {error && <p className="mt-4 text-sm font-semibold text-[#a11d34]">{error}</p>}

      <button
        onClick={() => void toConfirm()}
        disabled={!canContinue || checking}
        className="btn btn-gold mt-6 w-full"
      >
        {checking ? <Loader2 size={16} className="animate-spin" /> : null}
        {checking ? "Checking" : "Continue"}
      </button>
    </Panel>
  );
}
