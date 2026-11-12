"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, PenLine } from "lucide-react";
import { ConfirmContext, type Confirm, type ConfirmOptions } from "./useConfirm";

/**
 * One last look before something that cannot be taken back.
 *
 * On NEAR the user's key signs in the background (Privy signs a hash, no wallet
 * popup), so without this nothing marks the moment money actually leaves. Every
 * send, payment, refund and one-way choice goes through `confirm()` first.
 *
 * Kept quick on purpose: it opens instantly, Enter answers yes for money
 * (the person already reviewed it), and Escape or a tap outside is always no.
 * For one-way choices that are not payments (declining, withdrawing) Cancel is
 * the focused button instead, so a stray Enter does nothing harmful.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<ConfirmOptions | null>(null);
  const answer = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        answer.current?.(false);
        answer.current = resolve;
        setOpen(options);
      }),
    [],
  );

  const close = useCallback((value: boolean) => {
    answer.current?.(value);
    answer.current = null;
    setOpen(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {open && <ConfirmDialog options={open} onAnswer={close} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (value: boolean) => void }) {
  const money = (options.tone ?? "money") === "money";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onAnswer(false);
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onAnswer]);

  const note =
    options.note ?? (money ? "Your own key signs this. Selkie only pays the network fee." : undefined);

  return createPortal(
    <div className="overlay confirm-overlay" onClick={() => onAnswer(false)}>
      <div
        className="modal confirm-modal p-6 sm:p-7"
        role="alertdialog"
        aria-modal="true"
        aria-label={options.title}
        onClick={(e) => e.stopPropagation()}
      >
        <span className={money ? "modal-icon modal-icon-gold" : "modal-icon"}>
          {money ? <PenLine size={19} strokeWidth={2.3} /> : <AlertTriangle size={19} strokeWidth={2.3} />}
        </span>
        <p className="mt-4 font-display text-[1.6rem] font-bold leading-tight tracking-tight">{options.title}</p>
        {options.body && <div className="mt-2 text-[15px] leading-relaxed text-pen/65">{options.body}</div>}

        {options.rows && options.rows.length > 0 && (
          <div className="mt-5 overflow-hidden rounded-2xl border-2 border-pen/15 bg-card-bright">
            {options.rows.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-4 border-t-2 border-pen/[0.08] px-4 py-3 first:border-t-0"
              >
                <span className="shrink-0 text-[14px] font-semibold text-pen/55">{row.label}</span>
                <span className="flex min-w-0 items-center justify-end gap-2 break-all text-right text-[14px] font-bold text-pen/90">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {note && <p className="mt-4 text-[13px] leading-relaxed text-pen/50">{note}</p>}

        <div className="mt-6 flex gap-3">
          <button onClick={() => onAnswer(false)} autoFocus={!money} className="btn btn-dim flex-1">
            {options.cancel ?? "Not yet"}
          </button>
          <button
            onClick={() => onAnswer(true)}
            autoFocus={money}
            className={`btn flex-[1.4] ${money ? "btn-gold" : "btn-danger"}`}
          >
            {options.confirm}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
