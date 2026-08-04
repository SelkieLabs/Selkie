"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/useAuth";

/**
 * The way out, asked once.
 *
 * Signing out of a wallet feels irreversible even when it is not, so the modal
 * spends its two sentences saying the money is fine rather than warning about
 * anything. Cancel is focused and sits first: the safe answer should be the one
 * your hand is already on.
 *
 * Portaled to <body> because the header that opens it is a stacking context
 * with a backdrop filter, which would clip the overlay to the width of a pill.
 */
export function SignOutModal({ name, onClose }: { name?: string; onClose: () => void }) {
  const { signOut } = useAuth();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div
        className="modal p-7"
        role="dialog"
        aria-modal="true"
        aria-label="Sign out"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="modal-icon">
          <LogOut size={20} strokeWidth={2.2} />
        </span>
        <p className="mt-5 font-display text-2xl font-bold tracking-tight">
          {name ? `Sign out of ${name}?` : "Sign out?"}
        </p>
        <p className="mt-2 text-[15px] leading-relaxed text-pen/65">
          Your money stays exactly where it is. Signing back in the same way brings it right back.
        </p>
        <div className="mt-7 flex gap-3">
          <button onClick={onClose} autoFocus disabled={leaving} className="btn btn-dim flex-1">
            Cancel
          </button>
          <button
            onClick={() => {
              setLeaving(true);
              void signOut();
            }}
            disabled={leaving}
            className="btn btn-danger flex-1"
          >
            {leaving && <Loader2 size={15} className="animate-spin" />}
            {leaving ? "Signing out" : "Sign out"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
