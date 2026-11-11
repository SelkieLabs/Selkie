"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * The one dialog. Every flow that interrupts the wallet uses it, so closing,
 * escaping and the backdrop behave the same everywhere.
 *
 * Portaled to <body> because the wallet's own stacking context would otherwise
 * clip it, and locking the page behind it stops the awkward scroll-under.
 */
export function Sheet({
  title,
  onClose,
  children,
  wide = false,
}: {
  /** Screen-reader label. The visible heading lives in the content. */
  title: string;
  /** Omitted when the choice is not optional, which hides the close affordance. */
  onClose?: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div
        className="modal relative p-6 sm:p-7"
        style={wide ? { maxWidth: "30rem" } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-pen/45 transition-colors hover:bg-pen/[0.07] hover:text-pen"
          >
            <X size={17} strokeWidth={2.5} />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
