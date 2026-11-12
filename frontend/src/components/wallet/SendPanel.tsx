"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, AtSign, Check, Clock, ExternalLink, Loader2, Wallet } from "lucide-react";
import { Avatar } from "@/components/Layout";
import { ContractWarning } from "@/components/wallet/ContractWarning";
import { PlatformLogo } from "@/components/Mark";
import { Panel, PanelHead } from "@/components/wallet/Panel";
import { HandleSuggestions } from "@/components/wallet/HandleSuggestions";
import { PlatformToggle } from "@/components/wallet/PlatformToggle";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/useConfirm";
import {
  ApiError,
  api,
  newIdempotencyKey,
  type ActivityEntry,
  type Recipient,
  type SendResult,
} from "@/lib/api";
import { ADDRESS } from "@/lib/address";
import { features, isNear } from "@/lib/chain";
import { DOLLAR, cleanAmount, usd } from "@/lib/format";
import { useAccountCheck } from "@/lib/near-account";
import { useNearPay } from "@/lib/near-wallet";
import { takePayLink } from "@/lib/pay-link";
import { useHandleSuggestions } from "@/lib/useHandleSuggestions";
import { PLATFORMS, PLATFORM_FIELD, PLATFORM_LABEL, PLATFORM_PLACEHOLDER, type Platform } from "@/lib/platform";

type Step = "compose" | "confirm" | "done";

/**
 * Who the money is going to.
 *
 * Handles are the product and stay the default. Addresses exist because "send
 * it to my other wallet" and "pay this exchange" are real things people need,
 * and refusing them does not make Selkie simpler, it makes it a dead end.
 */
type Mode = "handle" | "address";

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
  const confirm = useConfirm();
  const nearPay = useNearPay();
  const target = useAccountCheck();
  const [step, setStep] = useState<Step>("compose");
  const [mode, setMode] = useState<Mode>("handle");
  const [platform, setPlatform] = useState<Platform>("x");
  // A pay link from the X bot fills the form once; the person still checks and signs.
  const [prefill] = useState(() => takePayLink("pay"));
  const [handle, setHandle] = useState(prefill?.handle ?? "");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState(prefill?.amount ?? "");
  const [note, setNote] = useState(prefill?.note ?? "");
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
  const cleanAddress = ADDRESS.clean(address);
  const addressValid = ADDRESS.valid(cleanAddress);
  const value = Number(amount);
  const tooMuch = value > Number(balance);
  const destinationReady = mode === "handle" ? cleanHandle.length > 0 : addressValid;
  const canContinue = destinationReady && value > 0 && !tooMuch;

  // People on Selkie matching what is typed (NEAR, X handles, from 3 letters).
  const [handleFocused, setHandleFocused] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const found = useHandleSuggestions(cleanHandle, isNear && mode === "handle" && platform === "x");
  const suggestions = found.length === 1 && found[0]!.username === cleanHandle ? [] : found;
  const showSuggestions = handleFocused && suggestions.length > 0;
  const pickSuggestion = (username: string) => {
    setHandle(username);
    setActiveSuggestion(-1);
    setHandleFocused(false);
    document.getElementById("send-amount")?.focus();
  };

  const reset = () => {
    setStep("compose");
    setHandle("");
    setAddress("");
    setAmount("");
    setNote("");
    setRecipient(null);
    setResult(null);
    setError(null);
    setIntent(null);
    target.reset();
  };

  const toConfirm = async () => {
    setError(null);
    // An address has nobody to look up. Nothing to show but the address itself,
    // which is exactly why the confirm step matters more here, not less.
    if (mode === "address") {
      // On NEAR, say now if the name is free or runs a contract, not after Send.
      const problem = isNear ? await target.check(cleanAddress) : null;
      if (problem) {
        setError(problem);
        return;
      }
      setIntent(newIdempotencyKey());
      setStep("confirm");
      return;
    }

    setChecking(true);
    try {
      setRecipient(await api.recipient(cleanHandle, platform));
      setIntent(newIdempotencyKey());
      setStep("confirm");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "We could not check that handle. Try again.",
      );
    } finally {
      setChecking(false);
    }
  };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      // On NEAR the user's own key signs; Selkie only prepares and relays.
      const memo = note.trim() || undefined;
      const sent = isNear
        ? await nearPay(() =>
            mode === "address"
              ? api.near.prepareTransfer({ toAccount: cleanAddress, amount, note: memo, toContract: target.toContract })
              : api.near.prepareSend({ to: cleanHandle, amount, note: memo }),
          )
        : await api.send(
            {
              to: mode === "address" ? cleanAddress : cleanHandle,
              amount,
              asset: DOLLAR,
              ...(mode === "handle" ? { platform } : {}),
              note: memo,
            },
            intent ?? undefined,
          );
      setResult(sent);
      setStep("done");
      toast("success", sent.message ?? "Sent.");
      onSent();
    } catch (err) {
      if (target.fromRefusal(err)) return;
      const message =
        err instanceof ApiError ? err.message : "That did not send. Your money is safe. Try again.";
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
          {mode === "address" ? (
            <p className="mt-2 font-mono text-[15px] font-bold text-pen/75">
              to {ADDRESS.short(cleanAddress)}
            </p>
          ) : (
            <p className="mt-2 flex items-center gap-2 font-display text-lg font-bold tracking-tight text-pen/75">
              to @{cleanHandle} <PlatformLogo platform={platform} size={14} />
            </p>
          )}
          <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-pen/65">
            {result.message}
          </p>
          {result.explorer && (
            <a
              href={result.explorer}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-bold text-pen/55 transition-colors hover:text-pen"
            >
              See it on the NEAR explorer <ExternalLink size={13} />
            </a>
          )}
          <button onClick={reset} className="btn btn-gold mt-7 w-full sm:w-auto sm:px-10">
            Send someone else
          </button>
        </div>
      </Panel>
    );
  }

  if (step === "confirm" && mode === "address") {
    return (
      <Panel>
        <button
          onClick={() => setStep("compose")}
          className="flex items-center gap-1.5 text-[13px] font-bold text-pen/55 transition-colors hover:text-pen"
        >
          <ArrowLeft size={15} /> Back
        </button>

        <div className="mt-5 flex flex-col items-center text-center">
          <span className="grid h-16 w-16 place-items-center rounded-2xl border-2 border-pen/20 bg-pen/[0.06] text-pen/70">
            <Wallet size={26} strokeWidth={2.2} />
          </span>

          <p className="mt-5 label">{ADDRESS.confirmLabel}</p>
          {/* Whole, never shortened. This is the last chance to catch a wrong
              address, and you cannot check what you cannot see. */}
          <p className="mt-2 max-w-md break-all rounded-xl bg-pen/[0.05] p-3.5 font-mono text-[13px] leading-relaxed text-pen/80">
            {cleanAddress}
          </p>

          <p className="mt-6 font-display text-[3rem] font-bold leading-none tracking-tight">
            {usd(amount)}
          </p>

          {target.isContract ? (
            <ContractWarning accountId={cleanAddress} accepted={target.accepted} onAccept={target.setAccepted} />
          ) : target.info?.onSelkie ? (
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-pen/65">
              This is a Selkie account, so it lands straight away.
            </p>
          ) : (
            <p className="mt-5 flex max-w-md items-start gap-2.5 rounded-xl bg-[#a11d34]/[0.07] p-3.5 text-left text-[14px] leading-relaxed text-pen/75">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#a11d34]" />
              <span>
                Check every character. Money sent to a wrong address cannot be undone by anyone, and
                unlike a handle there is nobody here to send it back.
              </span>
            </p>
          )}
        </div>

        {error && <p className="mt-4 text-center text-sm font-semibold text-[#a11d34]">{error}</p>}

        <button
          onClick={async () => {
            const yes = await confirm({
              title: `Send ${usd(amount)}?`,
              confirm: `Send ${usd(amount)}`,
              rows: [
                { label: "To", value: ADDRESS.short(cleanAddress) },
                { label: "Amount", value: usd(amount) },
              ],
              body: "Money sent to an address cannot be pulled back. Check it is the right one.",
            });
            if (yes) void send();
          }}
          disabled={sending || target.blocked}
          className="btn btn-gold mt-7 w-full"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : null}
          {sending ? "Sending" : `Send ${usd(amount)}`}
        </button>
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
              They already use Selkie, so this lands straight away
              {recipient.nearAccount && (
                <>
                  {" "}in <span className="font-mono text-[13px] text-pen/80">{recipient.nearAccount}</span>
                </>
              )}
              .
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
          onClick={async () => {
            const yes = await confirm({
              title: `Send ${usd(amount)} to @${recipient.handle.username}?`,
              confirm: `Send ${usd(amount)}`,
              rows: [
                { label: "To", value: `@${recipient.handle.username}` },
                { label: "Amount", value: usd(amount) },
              ],
              body: recipient.onSelkie
                ? "It lands in their account straight away."
                : `It waits for @${recipient.handle.username} until they sign in. If they never do, you can take it back.`,
            });
            if (yes) void send();
          }}
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
        blurb={
          mode === "handle"
            ? "Their handle is enough. They do not need an account, a wallet or an app."
            : ADDRESS.blurb
        }
      />

      {features.payToAddress && (
        <div className="seg mt-5">
          <button
            type="button"
            onClick={() => setMode("handle")}
            className={`seg-btn ${mode === "handle" ? "seg-on" : ""}`}
          >
            <AtSign size={14} strokeWidth={2.5} /> A handle
          </button>
          <button
            type="button"
            onClick={() => setMode("address")}
            className={`seg-btn ${mode === "address" ? "seg-on" : ""}`}
          >
            <Wallet size={14} strokeWidth={2.5} /> {ADDRESS.tab}
          </button>
        </div>
      )}

      {mode === "address" && (
        <>
          <label className="label mt-5 block" htmlFor="send-address">
            {ADDRESS.label}
          </label>
          <textarea
            id="send-address"
            className="field mt-2 min-h-[5.25rem] resize-none break-all font-mono text-[13px] leading-relaxed"
            placeholder={ADDRESS.placeholder}
            autoCapitalize={ADDRESS.capitalize}
            autoCorrect="off"
            spellCheck={false}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          {cleanAddress.length > 0 && !addressValid && (
            <p className="mt-2 text-sm font-semibold text-[#a11d34]">
              {ADDRESS.invalid}
            </p>
          )}
        </>
      )}

      {mode === "handle" && recent.length > 0 && (
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

      {mode === "handle" && (
        <>
          {PLATFORMS.length > 1 && <p className="label mt-6">Where</p>}
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
              role="combobox"
              aria-expanded={showSuggestions}
              aria-controls="send-suggestions"
              aria-autocomplete="list"
              aria-activedescendant={showSuggestions && activeSuggestion >= 0 ? `send-suggestions-${activeSuggestion}` : undefined}
              onFocus={() => setHandleFocused(true)}
              onBlur={() => setHandleFocused(false)}
              onChange={(e) => {
                setHandle(e.target.value);
                setActiveSuggestion(-1);
                setHandleFocused(true);
              }}
              onKeyDown={(e) => {
                if (showSuggestions && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                  e.preventDefault();
                  const step = e.key === "ArrowDown" ? 1 : -1;
                  setActiveSuggestion((i) => (i + step + suggestions.length) % suggestions.length);
                  return;
                }
                if (showSuggestions && e.key === "Escape") {
                  setHandleFocused(false);
                  return;
                }
                const chosen = showSuggestions ? suggestions[activeSuggestion] : undefined;
                if (e.key === "Enter" && chosen) {
                  e.preventDefault();
                  pickSuggestion(chosen.username);
                  return;
                }
                if (e.key === "Enter" && canContinue) void toConfirm();
              }}
            />
            {showSuggestions && (
              <HandleSuggestions
                id="send-suggestions"
                matches={suggestions}
                active={activeSuggestion}
                onPick={(match) => pickSuggestion(match.username)}
              />
            )}
          </div>
        </>
      )}

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
          {Number(balance) <= 0
            ? "You have no money to send yet. Add some from the Deposit tab."
            : `Your balance is too low. Send ${usd(balance)} or less.`}
        </p>
      )}
      {error && <p className="mt-4 text-sm font-semibold text-[#a11d34]">{error}</p>}

      <button
        onClick={() => void toConfirm()}
        disabled={!canContinue || checking || target.checking}
        className="btn btn-gold mt-6 w-full"
      >
        {checking || target.checking ? <Loader2 size={16} className="animate-spin" /> : null}
        {checking || target.checking ? "Checking" : "Continue"}
      </button>
    </Panel>
  );
}
