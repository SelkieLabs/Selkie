"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Menu, X as Close } from "lucide-react";
import Link from "next/link";
import { Wordmark } from "@/components/Mark";
import { useAuth } from "@/contexts/useAuth";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "What you can do" },
  { href: "#faq", label: "Questions" },
  { href: "/docs", label: "Docs" },
];

/**
 * The landing navigation.
 *
 * Separate from the app's <Header> on purpose. This one carries section
 * anchors and two calls to action; the app's carries an account menu. Sharing
 * one component would mean a prop for every difference, and the two have
 * almost nothing in common but the wordmark.
 */
export function Nav() {
  const { status, signIn } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // An open menu over a scrolling page reads as broken. Freeze the body while
  // it is up, and put it back exactly as found.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-ivory/[0.08] bg-sea-deep/70 py-3 backdrop-blur-xl"
          : "border-b border-transparent py-5"
      }`}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
        <Wordmark />

        <nav className="hidden items-center gap-1 lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3.5 py-2 text-[14px] font-semibold text-ivory/60 transition-colors hover:bg-ivory/[0.06] hover:text-ivory"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          <button
            onClick={signIn}
            disabled={status === "loading"}
            className="hidden text-[14px] font-bold text-ivory/70 transition-colors hover:text-ivory sm:block"
          >
            Sign in
          </button>
          <button
            onClick={signIn}
            disabled={status === "loading"}
            className="btn btn-gold btn-sm"
          >
            Get started <ArrowRight size={15} strokeWidth={2.6} />
          </button>
          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="grid h-10 w-10 place-items-center rounded-xl border border-ivory/15 text-ivory/75 lg:hidden"
          >
            <Menu size={18} strokeWidth={2.3} />
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-sea-deep/95 backdrop-blur-xl lg:hidden">
          <div className="flex items-center justify-between px-5 py-5 sm:px-8">
            <Wordmark />
            <button
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="grid h-10 w-10 place-items-center rounded-xl border border-ivory/15 text-ivory/75"
            >
              <Close size={18} strokeWidth={2.3} />
            </button>
          </div>
          <nav className="flex flex-col gap-1 px-5 pt-6 sm:px-8">
            {LINKS.map((link) =>
              link.href.startsWith("#") ? (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="border-b border-ivory/[0.08] py-4 font-display text-2xl font-bold tracking-tight text-ivory/85"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="border-b border-ivory/[0.08] py-4 font-display text-2xl font-bold tracking-tight text-ivory/85"
                >
                  {link.label}
                </Link>
              ),
            )}
            <button
              onClick={() => {
                setOpen(false);
                signIn();
              }}
              className="btn btn-gold mt-8"
            >
              Get started <ArrowRight size={16} strokeWidth={2.6} />
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
