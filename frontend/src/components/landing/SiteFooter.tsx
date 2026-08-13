"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Mark, XLogo } from "@/components/Mark";

const COLUMNS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "#how" },
      { label: "What you can do", href: "#features" },
      { label: "Questions", href: "#faq" },
    ],
  },
  {
    title: "Build",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "GitHub", href: "https://github.com/SelkieLabs/Selkie", external: true },
    ],
  },
  {
    title: "Follow",
    links: [{ label: "X", href: "https://x.com/SelkiePay", external: true }],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative mt-24 border-t border-ivory/[0.08] pb-10 pt-16">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <span className="flex items-center gap-2.5">
              <Mark size={22} />
              <span className="font-display text-lg font-bold tracking-tight text-ivory">
                Selkie
              </span>
            </span>
            <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-ivory/50">
              Money that finds people. Send to a handle and it gets there, whether or not they have
              ever heard of us.
            </p>
            <a
              href="https://x.com/SelkiePay"
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-ivory/15 text-ivory/65 transition-colors hover:border-gold/40 hover:bg-gold/10 hover:text-gold"
              aria-label="Selkie on X"
            >
              <XLogo size={16} />
            </a>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ivory/40">
                {column.title}
              </p>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[15px] font-medium text-ivory/60 transition-colors hover:text-ivory"
                      >
                        {link.label}
                        <ArrowUpRight size={13} strokeWidth={2.4} className="text-ivory/35" />
                      </a>
                    ) : link.href.startsWith("#") ? (
                      <a
                        href={link.href}
                        className="text-[15px] font-medium text-ivory/60 transition-colors hover:text-ivory"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-[15px] font-medium text-ivory/60 transition-colors hover:text-ivory"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col items-center justify-between gap-3 border-t border-ivory/[0.08] pt-7 text-[13.5px] text-ivory/40 sm:flex-row">
          <span>© {new Date().getFullYear()} Selkie Labs</span>
          <span>Send money to anyone with a handle</span>
        </div>
      </div>
    </footer>
  );
}
