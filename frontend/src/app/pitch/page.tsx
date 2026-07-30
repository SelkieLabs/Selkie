"use client";

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Coins,
  EyeOff,
  Globe,
  Lock,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { Mark, Wordmark, XLogo } from "@/components/Mark";
import { TokenIcon } from "@/components/TokenIcon";

/**
 * The pitch, as a full-screen deck you click through to open the demo. Six
 * slides, stacked in 3D depth: click Next and the slide you leave rises and
 * sinks into the dark while the next surfaces from the deep (see .deck-* in
 * index.css). Arrow keys or the buttons drive it. Numbers top-right and a
 * gold progress bar along the bottom keep your place.
 */

/** A staggered content block: rises and unblurs when its slide surfaces. */
function Rise({ i, children, className = "" }: { i: number; children: ReactNode; className?: string }) {
  return (
    <div className={`rise ${className}`} style={{ "--i": i } as CSSProperties}>
      {children}
    </div>
  );
}

/** A command chip, matching the docs. */
function Cmd({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md border-2 border-pen/12 bg-[#f2e6cc] px-1.5 py-0.5 font-mono text-[0.82em] font-semibold text-gold-ink">
      {children}
    </code>
  );
}

const SURFACES = [
  {
    icon: <XLogo size={18} />,
    tag: "On X",
    title: "Pay from the timeline",
    body: "Mention @SelkiePay in a post or reply. Selkie settles it and replies with a private receipt.",
    demo: <Cmd>@SelkiePay send 5 CC to @ada</Cmd>,
  },
  {
    icon: <MessageCircle size={18} />,
    tag: "On Telegram",
    title: "Pay from a chat",
    body: "Open @selkiepay_bot and tap start. Your Telegram username is the wallet, with buttons and a command menu.",
    demo: <Cmd>send 10 USDCx to @ada</Cmd>,
  },
  {
    icon: <Wallet size={18} />,
    tag: "On the web",
    title: "The full dashboard",
    body: "Sign in with X for balances, send, requests, activity and a shareable pay page for any handle.",
    demo: <Cmd>selkiepay.vercel.app</Cmd>,
  },
];

const WHY_CANTON = [
  { icon: <EyeOff size={18} />, t: "Privacy is native", d: "A payment is shared only with the two people in it, enforced by the ledger. Private by default, not a bolt-on." },
  { icon: <Coins size={18} />, t: "Real assets", d: "Canton Coin is native. Bitcoin and Ether arrive as cBTC and cETH through one shared token standard." },
  { icon: <Zap size={18} />, t: "Settlement, no gas games", d: "Payments settle deterministically. No mempool to front-run, no gas auction to lose. That is why it feels instant." },
];

const VISION = [
  { icon: <TrendingUp size={16} />, t: "Prediction markets", d: "Back your take and settle privately in cBTC, cETH or CC." },
  { icon: <Users size={16} />, t: "Group savings pools", d: "Handle-based rotating pots, now instant and private." },
  { icon: <Globe size={16} />, t: "Cross-border by handle", d: "Send money home in a digital dollar, no exchange, no wire." },
  { icon: <Store size={16} />, t: "Handle as a storefront", d: "One pay-link turns any handle into a private way to get paid." },
];

/* ---- the six slides ---- */

function SlideTitle() {
  return (
    <div className="relative z-10 mx-auto w-full max-w-3xl text-center">
      <Rise i={0}>
        <div className="flex justify-center">
          <Mark size={62} />
        </div>
      </Rise>
      <Rise i={1}>
        <p className="eyebrow mt-7 text-gold">Selkie · HackCanton Season 2</p>
      </Rise>
      <Rise i={2}>
        <h1 className="mt-4 font-display text-[clamp(2.6rem,7vw,5rem)] font-bold leading-[1.02] tracking-[-0.03em] text-ivory text-balance">
          Any handle is a<br />
          <span className="text-gold-grad">private wallet.</span>
        </h1>
      </Rise>
      <Rise i={3}>
        <p className="mx-auto mt-6 max-w-xl text-[1.05rem] leading-relaxed text-ivory/70">
          Send real money to an X or Telegram name in seconds, on the Canton Network. No app, no
          seed phrase, no gas, no public balance.
        </p>
      </Rise>
      <Rise i={4}>
        <p className="mt-10 text-[12px] font-bold uppercase tracking-[0.18em] text-ivory/40">
          Press the arrow to begin
        </p>
      </Rise>
    </div>
  );
}

function SlideProblem() {
  return (
    <div className="relative z-10 mx-auto w-full max-w-3xl text-center">
      <Rise i={0}>
        <p className="eyebrow text-gold">The problem</p>
      </Rise>
      <Rise i={1}>
        <h2 className="mt-3 font-display text-[clamp(2rem,5vw,3.4rem)] font-bold leading-[1.06] tracking-[-0.02em] text-ivory text-balance">
          Crypto keeps losing people at the same wall.
        </h2>
      </Rise>
      <div className="mt-9 grid gap-4 text-left sm:grid-cols-2">
        <Rise i={2}>
          <div className="chunk h-full p-6">
            <span className="grid h-11 w-11 place-items-center rounded-xl border-2 border-pen bg-[#f7ecd2] text-gold-ink">
              <Lock size={19} />
            </span>
            <h3 className="mt-4 font-display text-lg font-bold">The friction wall</h3>
            <p className="mt-1.5 text-sm font-medium leading-relaxed text-pen/65">
              Install a wallet, write down twelve words, buy gas, then paste a forty-character
              address you cannot read. Most people quit right here.
            </p>
          </div>
        </Rise>
        <Rise i={3}>
          <div className="chunk h-full p-6">
            <span className="grid h-11 w-11 place-items-center rounded-xl border-2 border-pen bg-[#f7ecd2] text-gold-ink">
              <EyeOff size={19} />
            </span>
            <h3 className="mt-4 font-display text-lg font-bold">The privacy wall</h3>
            <p className="mt-1.5 text-sm font-medium leading-relaxed text-pen/65">
              The apps that finally remove that friction run on public chains, so every balance and
              payment becomes a post the whole world can read forever.
            </p>
          </div>
        </Rise>
      </div>
      <Rise i={4}>
        <p className="mt-8 text-[1.05rem] font-semibold text-ivory/80">
          You get ease, or you get privacy. Almost nobody gives you both.
        </p>
      </Rise>
    </div>
  );
}

function SlideSolution() {
  return (
    <div className="relative z-10 mx-auto w-full max-w-3xl text-center">
      <Rise i={0}>
        <p className="eyebrow text-gold">The solution</p>
      </Rise>
      <Rise i={1}>
        <h2 className="mt-3 font-display text-[clamp(2rem,5vw,3.4rem)] font-bold leading-[1.06] tracking-[-0.02em] text-ivory text-balance">
          Your handle is the wallet.
          <br />
          <span className="text-gold-grad">Private by default.</span>
        </h2>
      </Rise>
      <Rise i={2}>
        <div className="chunk-gold mx-auto mt-8 max-w-xl px-6 py-7">
          <p className="eyebrow">The whole product</p>
          <p className="mt-2.5 font-mono text-[clamp(1.4rem,4.6vw,2.4rem)] font-bold text-pen">
            send 5 CC to @ada
          </p>
        </div>
      </Rise>
      <Rise i={3}>
        <p className="mx-auto mt-6 max-w-xl text-[1.05rem] leading-relaxed text-ivory/70">
          One line moves money to a name. If they are new, the payment itself opens their wallet, and
          it stays between the two of you.
        </p>
      </Rise>
    </div>
  );
}

function SlideSurfaces() {
  return (
    <div className="relative z-10 mx-auto w-full max-w-5xl">
      <div className="text-center">
        <Rise i={0}>
          <p className="eyebrow text-gold">One wallet, three ways in</p>
        </Rise>
        <Rise i={1}>
          <h2 className="mt-3 font-display text-[clamp(1.9rem,4.6vw,3.2rem)] font-bold tracking-[-0.02em] text-ivory text-balance">
            Wherever people already talk.
          </h2>
        </Rise>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {SURFACES.map((s, i) => (
          <Rise key={s.tag} i={2 + i}>
            <div className="chunk flex h-full flex-col p-6 text-left">
              <span className="grid h-11 w-11 place-items-center rounded-xl border-2 border-pen bg-[#f7ecd2] text-gold-ink">
                {s.icon}
              </span>
              <p className="eyebrow mt-4">{s.tag}</p>
              <h3 className="mt-1 font-display text-lg font-bold">{s.title}</h3>
              <p className="mt-1.5 flex-1 text-sm font-medium leading-relaxed text-pen/65">{s.body}</p>
              <div className="mt-4">{s.demo}</div>
            </div>
          </Rise>
        ))}
      </div>
    </div>
  );
}

function SlideCanton() {
  return (
    <div className="relative z-10 mx-auto w-full max-w-4xl">
      <div className="text-center">
        <Rise i={0}>
          <p className="eyebrow text-gold">Why Canton</p>
        </Rise>
        <Rise i={1}>
          <h2 className="mt-3 font-display text-[clamp(1.9rem,4.6vw,3.2rem)] font-bold tracking-[-0.02em] text-ivory text-balance">
            Real privacy. Real assets. Real settlement.
          </h2>
        </Rise>
      </div>
      <div className="mt-9 grid gap-4 md:grid-cols-3">
        {WHY_CANTON.map((c, i) => (
          <Rise key={c.t} i={2 + i}>
            <div className="chunk h-full p-6 text-left">
              <span className="grid h-11 w-11 place-items-center rounded-xl border-2 border-pen bg-[#f7ecd2] text-gold-ink">
                {c.icon}
              </span>
              <h3 className="mt-4 font-display text-base font-bold">{c.t}</h3>
              <p className="mt-1.5 text-sm font-medium leading-relaxed text-pen/65">{c.d}</p>
            </div>
          </Rise>
        ))}
      </div>
      <Rise i={5}>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          {[
            ["CC", "Canton Coin"],
            ["USDCX", "USDCx"],
            ["CBTC", "cBTC"],
            ["CETH", "cETH"],
          ].map(([a, label]) => (
            <span key={a} className="chunk inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-bold">
              <TokenIcon asset={a} size={19} />
              {label}
            </span>
          ))}
          <span className="inline-flex items-center gap-2 rounded-full border-2 border-gold/30 bg-gold/10 px-3.5 py-2 text-sm font-bold text-gold">
            <ShieldCheck size={16} /> Live on DevNet, no mocks
          </span>
        </div>
      </Rise>
    </div>
  );
}

function SlideVision() {
  return (
    <div className="relative z-10 mx-auto w-full max-w-4xl text-center">
      <Rise i={0}>
        <p className="eyebrow text-gold">Where this goes</p>
      </Rise>
      <Rise i={1}>
        <h2 className="mt-3 font-display text-[clamp(1.9rem,4.6vw,3.2rem)] font-bold tracking-[-0.02em] text-ivory text-balance">
          A handle that pays is a platform.
        </h2>
      </Rise>
      <div className="mt-8 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
        {VISION.map((v, i) => (
          <Rise key={v.t} i={2 + i}>
            <div className="chunk h-full p-5">
              <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-pen bg-[#f7ecd2] text-gold-ink">
                {v.icon}
              </span>
              <p className="mt-3 text-sm font-bold">{v.t}</p>
              <p className="mt-1 text-[13px] font-medium leading-relaxed text-pen/55">{v.d}</p>
            </div>
          </Rise>
        ))}
      </div>
      <Rise i={6}>
        <p className="mt-9 font-display text-2xl font-bold text-ivory sm:text-3xl">
          Your handle is already a wallet.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <a href="/auth/x/login" className="btn btn-gold">
            <XLogo size={15} /> Continue with X
          </a>
          <a href="https://selkiepay.vercel.app" target="_blank" rel="noreferrer" className="btn btn-dim">
            See it live
          </a>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-semibold text-ivory/55">
          <a href="https://x.com/SelkiePay" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-ivory">
            <XLogo size={13} /> @SelkiePay
          </a>
          <a href="https://t.me/selkiepay_bot" target="_blank" rel="noreferrer" className="hover:text-ivory">
            @selkiepay_bot
          </a>
          <a href="https://github.com/martinvibes/Selkie" target="_blank" rel="noreferrer" className="hover:text-ivory">
            GitHub
          </a>
        </div>
      </Rise>
    </div>
  );
}

const SLIDES = [SlideTitle, SlideProblem, SlideSolution, SlideSurfaces, SlideCanton, SlideVision];
const COUNT = SLIDES.length;
const pad = (n: number) => String(n).padStart(2, "0");

/** Deep-link support: /pitch#4 opens on slide 4, so a presenter can jump in. */
function slideFromHash() {
  const n = parseInt(window.location.hash.replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n >= 1 && n <= COUNT ? n - 1 : 0;
}

export default function Pitch() {
  const [index, setIndex] = useState(0);

  const go = useCallback((d: number) => {
    setIndex((i) => Math.min(COUNT - 1, Math.max(0, i + d)));
  }, []);

  // The hash only exists in the browser, so the deep link is read on mount
  // rather than at init. Declared above the sync effect below so it reads the
  // incoming hash before that effect rewrites it.
  useEffect(() => {
    setIndex(slideFromHash());
  }, []);

  // Keep the URL hash in step without piling up history entries.
  useEffect(() => {
    history.replaceState(null, "", `#${index + 1}`);
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Home") {
        setIndex(0);
      } else if (e.key === "End") {
        setIndex(COUNT - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const atStart = index === 0;
  const atEnd = index === COUNT - 1;

  return (
    <div className="deck">
      {/* ambient light, behind the slides */}
      <span className="orb -left-24 top-10 h-72 w-72 bg-gold/20" style={{ animation: "drift 9s ease-in-out infinite" }} />
      <span className="orb -right-20 bottom-8 h-80 w-80 bg-[#7ebed4]/12" style={{ animation: "drift 11s ease-in-out infinite reverse" }} />

      {/* top bar: brand + slide counter */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-5 py-5 sm:px-8">
        <Wordmark />
        <span className="num flex items-baseline gap-1 text-ivory">
          <span className="text-xl font-bold sm:text-2xl">{pad(index + 1)}</span>
          <span className="text-sm font-semibold text-ivory/40">/ {pad(COUNT)}</span>
        </span>
      </div>

      {/* the stage: all slides mounted, positioned by depth state */}
      <div className="deck-stage">
        {SLIDES.map((Slide, i) => {
          const state = i === index ? "is-active" : i < index ? "is-past" : "is-future";
          return (
            <div key={i} className={`deck-slide ${state}`} aria-hidden={i !== index}>
              <span className="deck-figure">{pad(i + 1)}</span>
              <Slide />
            </div>
          );
        })}
      </div>

      {/* bottom bar: prev, progress segments, next */}
      <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-between gap-4 px-5 py-6 sm:px-8">
        <button
          onClick={() => go(-1)}
          disabled={atStart}
          aria-label="Previous slide"
          className="btn btn-dim btn-sm !h-11 !w-11 !p-0 disabled:opacity-30"
        >
          <ArrowLeft size={17} />
        </button>

        <div className="flex items-center gap-2" role="tablist" aria-label="Slides">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-selected={i === index}
              role="tab"
              className={`deck-seg ${i === index ? "on" : i < index ? "done" : ""}`}
            >
              <span />
            </button>
          ))}
        </div>

        {atEnd ? (
          <a
            href="https://selkiepay.vercel.app"
            target="_blank"
            rel="noreferrer"
            className="btn btn-gold btn-sm !h-11"
          >
            <Sparkles size={15} /> Live app
          </a>
        ) : (
          <button onClick={() => go(1)} className="btn btn-gold btn-sm !h-11">
            Next <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
