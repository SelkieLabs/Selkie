"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Home, LogOut, Wallet } from "lucide-react";
import Link from "next/link";
import { LoaderMark, Mark, Wordmark, XLogo } from "./Mark";
import { useAuth } from "@/contexts/useAuth";
import type { Me } from "@/lib/api";

export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto w-full px-5 sm:px-8 ${wide ? "max-w-6xl" : "max-w-2xl"}`}>{children}</div>
  );
}

export function Avatar({ me, size = 32 }: { me: Me; size?: number }) {
  const initial = me.handle.replace(/^@/, "").slice(0, 1).toUpperCase();
  return me.avatar ? (
    <img
      src={me.avatar}
      alt=""
      referrerPolicy="no-referrer"
      className="rounded-full border-2 border-pen object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="grid place-items-center rounded-full border-2 border-pen bg-gradient-to-br from-gold-light to-gold-deep font-display font-bold text-pen"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

/** Signing out is reversible but surprising when accidental, so it asks. */
function SignOutModal({ handle, onClose }: { handle: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portaled to <body>: the header's stacking context would clip the overlay.
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
        <p className="mt-5 font-display text-2xl font-bold tracking-tight">Sign out of {handle}?</p>
        <p className="mt-2 text-[15px] leading-relaxed text-pen/65">
          Your wallet stays safe on Canton. Signing back in with X brings it right back.
        </p>
        <div className="mt-7 flex gap-3">
          <button onClick={onClose} autoFocus className="btn btn-dim flex-1">
            Cancel
          </button>
          <a href="/auth/logout" className="btn btn-danger flex-1">
            Sign out
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The handle pill: who you are, and the way out. */
function AccountPill({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="chunk chunk-pop flex items-center gap-2.5 py-1.5 pl-2 pr-3.5"
      >
        <Avatar me={me} size={30} />
        <span className="font-display text-sm font-bold">{me.handle}</span>
        <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="menu" role="menu">
          <p className="px-3 pb-1.5 pt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-pen/45">
            Signed in as {me.handle}
          </p>
          <Link href="/dashboard/activity" onClick={() => setOpen(false)} className="menu-item" role="menuitem">
            <Wallet size={16} /> Your wallet
          </Link>
          <Link href="/" onClick={() => setOpen(false)} className="menu-item" role="menuitem">
            <Home size={16} /> Home
          </Link>
          <div className="mx-2 my-1.5 rule" />
          <button
            onClick={() => {
              setOpen(false);
              setConfirmOut(true);
            }}
            className="menu-item text-[#a11d34]"
            role="menuitem"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}

      {confirmOut && <SignOutModal handle={me.handle} onClose={() => setConfirmOut(false)} />}
    </div>
  );
}

export function Header() {
  const { me } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 14);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Floating pills at the top of the page; once content slides underneath,
  // the bar grows a blurred dark strip so the pills never fight the page.
  // (The sign-out modal is portaled to <body>, so the backdrop-filter here
  // can't clip it.)
  return (
    <header
      className={`sticky top-0 z-40 transition-all duration-300 ${
        scrolled
          ? "border-b border-ivory/[0.08] bg-sea-deep/55 py-2.5 shadow-[0_14px_34px_rgba(1,4,8,0.45)] backdrop-blur-xl"
          : "border-b border-transparent bg-transparent pb-0 pt-4"
      }`}
    >
      <Shell wide>
        <div className="flex items-center justify-between gap-4">
          {/* No pill: the mark sits straight on the water. */}
          <Wordmark />
          {me ? (
            <AccountPill me={me} />
          ) : (
            <a href="/auth/x/login" className="btn btn-dim btn-sm">
              <XLogo size={13} /> Continue with X
            </a>
          )}
        </div>
      </Shell>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-28 pb-10">
      <Shell wide>
        <div className="flex flex-col items-center justify-between gap-4 text-sm text-ivory/55 sm:flex-row">
          <span className="flex items-center gap-2.5">
            <Mark size={18} />
            <span className="font-display font-bold text-ivory/85">Selkie</span>
          </span>
          <nav className="flex items-center gap-6">
            <Link href="/pitch" className="font-semibold transition-colors hover:text-ivory">
              Pitch
            </Link>
            <Link href="/docs" className="font-semibold transition-colors hover:text-ivory">
              Docs
            </Link>
            <a
              href="https://github.com/martinvibes/Selkie"
              target="_blank"
              rel="noreferrer"
              className="font-semibold transition-colors hover:text-ivory"
            >
              GitHub
            </a>
          </nav>
          <span>Private payments on Canton · HackCanton S2</span>
        </div>
      </Shell>
    </footer>
  );
}

/** Full-screen branded loader: the echo mark pulsing over a sweeping gold bar. */
export function Spinner() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5">
      <LoaderMark size={46} />
      <div className="loader-bar" />
    </div>
  );
}
