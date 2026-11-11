"use client";

import { useState } from "react";
import { Bell, Loader2, Merge, Sparkles, X } from "lucide-react";
import { TelegramLogo, XLogo } from "@/components/Mark";
import { Sheet } from "@/components/Sheet";
import { useAuth } from "@/contexts/useAuth";
import type { ClaimOutcome } from "@/lib/api";
import { features, isNear } from "@/lib/chain";
import { DOLLAR, money, usd } from "@/lib/format";
import { usePush } from "@/lib/push";

/**
 * The one question asked before an account exists.
 *
 * A login we have never seen does not quietly become a wallet. This screen is
 * why: it is the difference between one person with one wallet and one person
 * with two, and it doubles as terms acceptance so it costs nothing to show.
 */
export function CreateAccountGate() {
  const { createAccount, signOut, busy } = useAuth();

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-5">
      <div className="chunk w-full max-w-md p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gold/20 text-gold-ink">
          <Sparkles size={24} strokeWidth={2.2} />
        </span>
        <h1 className="mt-5 font-display text-[1.7rem] font-bold leading-tight tracking-tight">
          {isNear ? "One tap and your NEAR account is ready" : "One tap and your wallet is ready"}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-pen/65">
          {isNear
            ? "Your own NEAR account, named after your X handle. Its only key is yours and Selkie never sees it. No seed phrase, nothing to write down."
            : "No seed phrase, no app to install, nothing to write down. Selkie looks after the boring part so you can just send money."}
        </p>

        <button
          onClick={() => void createAccount()}
          disabled={busy}
          className="btn btn-gold mt-7 w-full"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : null}
          {busy ? "Setting up" : isNear ? "Create my account" : "Create my wallet"}
        </button>

        <p className="mt-4 text-[13px] leading-relaxed text-pen/45">
          By continuing you agree to our terms and privacy policy.
        </p>

        <button
          onClick={() => void signOut()}
          className="mt-5 text-[13px] font-bold text-pen/55 underline underline-offset-4 transition-colors hover:text-pen"
        >
          Use a different account
        </button>
      </div>
    </div>
  );
}

/**
 * The moment the whole product is built around: money that was sent to a handle
 * before its owner had ever heard of Selkie, landing the second they prove the
 * handle is theirs.
 */
export function ClaimCelebration({ claimed }: { claimed: ClaimOutcome[] }) {
  const { dismissClaimed } = useAuth();
  const handle = claimed[0]?.handle.username;

  const totals = new Map<string, number>();
  for (const outcome of claimed) {
    for (const amount of outcome.amounts) {
      totals.set(amount.asset, (totals.get(amount.asset) ?? 0) + Number(amount.amount));
    }
  }
  const lines = [...totals].map(([asset, total]) =>
    asset === DOLLAR ? usd(total) : `${money(total)} ${asset}`,
  );
  if (lines.length === 0) return null;

  return (
    <Sheet title="Money was waiting for you" onClose={dismissClaimed}>
      <div className="flex flex-col items-center text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-gold/20 text-gold-ink">
          <Sparkles size={24} strokeWidth={2.2} />
        </span>
        <p className="mt-5 font-display text-[2rem] font-bold leading-none tracking-tight">
          {lines.join(" + ")}
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-pen/65">
          {handle ? (
            <>
              Someone sent this to <b>@{handle}</b> before you joined. It is in your{" "}
              {isNear ? "NEAR account" : "wallet"} now.
            </>
          ) : (
            <>This was waiting for you. It is in your {isNear ? "NEAR account" : "wallet"} now.</>
          )}
        </p>
        <button onClick={dismissClaimed} className="btn btn-gold mt-7 w-full">
          Nice
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Two accounts, one person. Never merged without asking, because a merge moves
 * money between wallets.
 */
export function MergePrompt() {
  const { merge, confirmMerge, dismissMerge, busy } = useAuth();
  if (!merge) return null;

  return (
    <Sheet title="Bring your other wallet here" onClose={busy ? undefined : dismissMerge}>
      <div className="flex flex-col items-center text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-gold/20 text-gold-ink">
          <Merge size={22} strokeWidth={2.2} />
        </span>
        <p className="mt-5 font-display text-2xl font-bold tracking-tight">
          You already have a wallet here
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-pen/65">
          That account came with its own Selkie wallet. Bring its money into this one so everything
          lives in a single place.
        </p>
        <div className="mt-7 flex w-full gap-3">
          <button onClick={dismissMerge} disabled={busy} className="btn btn-dim flex-1">
            Not now
          </button>
          <button onClick={() => void confirmMerge()} disabled={busy} className="btn btn-gold flex-1">
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            {busy ? "Moving" : "Bring it over"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * A wallet nobody can pay is half a wallet. This is the nudge, and linking is
 * also what releases anything already waiting for that handle.
 */
export function LinkHandleBanner() {
  const { linkX, linkTelegram } = useAuth();

  return (
    <div className="chunk-gold mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
      <div className="flex-1">
        <p className="font-display text-[17px] font-bold tracking-tight">
          {isNear ? "Add your X handle so people can pay you" : "Add a handle so people can pay you"}
        </p>
        <p className="mt-1 text-[14px] leading-relaxed text-pen/70">
          {isNear
            ? "Your NEAR account is named after it, and anything already waiting for it lands the moment you do."
            : "Anything already waiting for your handle lands the moment you do. Either one works."}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button onClick={() => void linkX()} className="btn btn-dark btn-sm">
          <XLogo size={13} /> Add X
        </button>
        {features.telegram && (
          <button onClick={() => void linkTelegram()} className="btn btn-dark btn-sm">
            <TelegramLogo size={14} /> Add Telegram
          </button>
        )}
      </div>
    </div>
  );
}

const NUDGE_DISMISSED = "selkie.push-nudge-dismissed";

function nudgeDismissed(): boolean {
  try {
    return localStorage.getItem(NUDGE_DISMISSED) === "1";
  } catch {
    return false;
  }
}

/**
 * One quiet offer, on the home tab, to be told when money comes in.
 *
 * Asked from a button, never on load: a browser's permission prompt that
 * appears unasked mostly gets "Block", and that answer is permanent. Shown
 * only while the answer could still be yes, and gone for good once dismissed.
 */
export function NotifyNudge() {
  const { state, busy, error, turnOn } = usePush();
  const [dismissed, setDismissed] = useState(nudgeDismissed);
  if (!features.push || dismissed || (state !== "off" && !(busy || error))) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(NUDGE_DISMISSED, "1");
    } catch {
      // Private mode: it comes back next visit, which is fine.
    }
  };

  return (
    <div className="chunk relative flex flex-col gap-4 p-5 pr-12 sm:flex-row sm:items-center">
      <button
        onClick={dismiss}
        aria-label="Not now"
        className="absolute right-3 top-3 rounded-full p-1.5 text-pen/40 transition hover:bg-pen/[0.06] hover:text-pen/70"
      >
        <X size={16} strokeWidth={2.4} />
      </button>
      <div className="flex-1">
        <p className="font-display text-[17px] font-bold tracking-tight">Know the moment you are paid</p>
        <p className="mt-1 text-[14px] leading-relaxed text-pen/70">
          {error ?? "Get a notification on this device when money comes in, even with Selkie closed."}
        </p>
      </div>
      <button onClick={() => void turnOn()} disabled={busy} className="btn btn-dark btn-sm shrink-0">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} strokeWidth={2.4} />} Turn on
      </button>
    </div>
  );
}
