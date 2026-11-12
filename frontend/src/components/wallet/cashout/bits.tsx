"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Check, Loader2, RotateCcw, X } from "lucide-react";
import type { Stage } from "@/lib/other-chain";
import { FLOW, flowIndex, type Step } from "./model";
import "./cashout.css";

/**
 * The small pieces every cash-out screen (and the add-from-another-chain card)
 * is built from. Styled by cashout.css, in Tide.
 */

/** The card the whole flow lives on. */
export function Surface({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <section className={`co ${className}`} aria-label={label}>
      {children}
    </section>
  );
}

export function Head({ kicker, title, blurb }: { kicker?: string; title: string; blurb?: ReactNode }) {
  return (
    <div>
      {kicker && (
        <p className="co-kicker">
          <i aria-hidden="true" />
          {kicker}
        </p>
      )}
      <h1 className="co-title">{title}</h1>
      {blurb && <p className="co-blurb">{blurb}</p>}
    </div>
  );
}

/**
 * Where you are: four steps with names, because "step 3 of 4" means nothing
 * and "Details" says what is being asked. Steps already done take you back.
 */
export function Stepper({ at, onJump }: { at: Step; onJump: (step: Step) => void }) {
  const now = flowIndex(at);
  return (
    <nav className="co-steps" aria-label="Cash out steps">
      {FLOW.map((entry, index) => {
        const state = index < now ? "done" : index === now ? "now" : "next";
        return (
          <button
            key={entry.step}
            type="button"
            className="co-step"
            data-state={state}
            disabled={state !== "done"}
            aria-current={state === "now" ? "step" : undefined}
            onClick={() => onJump(entry.step)}
          >
            <span className="co-step-bar" aria-hidden="true" />
            <span>
              <b>{index + 1}</b>
              {entry.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/** What has been picked so far, each one a way back to change it. */
export function Trail({ items }: { items: Array<{ key: string; icon?: ReactNode; text: ReactNode; label: string; onClick: () => void }> }) {
  if (items.length === 0) return null;
  return (
    <div className="co-trail">
      {items.map((item) => (
        <button key={item.key} type="button" className="co-pill" onClick={item.onClick} aria-label={item.label}>
          {item.icon}
          <span>{item.text}</span>
        </button>
      ))}
    </div>
  );
}

export function Back({ onClick, children = "Back" }: { onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" className="co-back" onClick={onClick}>
      <ArrowLeft size={15} /> {children}
    </button>
  );
}

export function Note({ tone, icon, children }: { tone?: "warn" | "info"; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="co-note" data-tone={tone}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

/** One line of a receipt: what on the left, the value on the right. */
export function Row({
  label,
  children,
  icon,
  mono,
  muted,
}: {
  label: string;
  children: ReactNode;
  icon?: ReactNode;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="co-row" data-muted={muted || undefined}>
      <span>{label}</span>
      <span className="co-row-value">
        {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
        <span className={mono ? "co-mono" : undefined}>{children}</span>
      </span>
    </div>
  );
}

/**
 * Shown before paying an account that runs a contract. The same words and
 * the same tick box as the Send screen's warning, drawn for this dark card.
 */
export function ContractNotice({
  accountId,
  accepted,
  onAccept,
}: {
  accountId: string;
  accepted: boolean;
  onAccept: (accepted: boolean) => void;
}) {
  return (
    <div role="alert" className="co-note" data-tone="warn" style={{ display: "block" }}>
      <p className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-[3px] shrink-0 text-[#f2a08e]" />
        <span>
          <b>This is a smart contract, not a wallet.</b> Most contracts, staking pools for one, cannot send USDC
          back out, so money sent to <span className="co-mono break-all text-[12.5px]">{accountId}</span> can be
          stuck for good.
        </span>
      </p>
      <label className="co-check">
        <input type="checkbox" checked={accepted} onChange={(e) => onAccept(e.target.checked)} />
        <span>I know this contract accepts USDC. Pay it anyway.</span>
      </label>
    </div>
  );
}

/** Progress as a list of stages, filled in as they happen. */
export function Timeline({ stages }: { stages: Stage[] }) {
  return (
    <ol className="co-tl">
      {stages.map((stage, index) => (
        <li key={`${index}-${stage.title}`} data-state={stage.state} style={{ ["--i" as string]: index }}>
          <span className="co-node" aria-hidden="true">
            {stage.state === "done" ? (
              <Check size={15} strokeWidth={3} />
            ) : stage.state === "now" ? (
              <Loader2 size={15} strokeWidth={2.6} className="co-spin" />
            ) : stage.state === "back" ? (
              <RotateCcw size={13} strokeWidth={2.6} />
            ) : stage.state === "bad" ? (
              <X size={14} strokeWidth={3} />
            ) : (
              index + 1
            )}
          </span>
          <div className="min-w-0">
            <p className="co-tl-title">
              {stage.title}
              <span className="sr-only">
                {stage.state === "done" ? " (done)" : stage.state === "now" ? " (happening now)" : stage.state === "next" ? " (next)" : ""}
              </span>
            </p>
            {stage.detail && (
              <p className="co-tl-detail" data-gold={stage.gold || undefined}>
                {stage.detail}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A live price runs down to its next refresh. `at` restarts the ring. */
export function Fresh({ at, every, loading }: { at: number; every: number; loading: boolean }) {
  return (
    <span className="co-fresh" style={{ ["--co-every" as string]: `${every}s` }}>
      {loading ? (
        <Loader2 size={12} className="co-spin" />
      ) : (
        <svg key={at} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="6" cy="6" r="5" fill="none" stroke="rgba(233,241,236,.14)" strokeWidth="2" />
          <circle cx="6" cy="6" r="5" fill="none" stroke="#7fd1b9" strokeWidth="2" />
        </svg>
      )}
      {loading ? "Updating the price" : `Live price · updates every ${every}s`}
    </span>
  );
}
