"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowRight,
  AtSign,
  Banknote,
  Check,
  ClipboardX,
  Clock,
  Coins,
  Undo2,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { Faq } from "@/components/landing/Faq";
import { Nav } from "@/components/landing/Nav";
import { SendCard } from "@/components/landing/SendCard";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { Redirect } from "@/components/Redirect";
import { Reveal } from "@/components/Reveal";
import { useAuth } from "@/contexts/useAuth";

/** The numbers that are actually true today. No invented user counts. */
const PROOF = [
  { figure: "Seconds", caption: "for money to land" },
  { figure: "$0", caption: "for the person you pay" },
  { figure: "One tap", caption: "to open your account" },
  { figure: "Nothing", caption: "for them to install" },
];

const PAINS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ClipboardX,
    title: "A wall of letters and numbers",
    body: "Copy it wrong by one character and the money is gone, with nobody to call about it.",
  },
  {
    icon: UserPlus,
    title: "They have to sign up first",
    body: "You cannot pay someone until they have gone and made an account, picked a password and saved a code.",
  },
  {
    icon: Coins,
    title: "Small amounts cost too much",
    body: "By the time the fees are out, sending someone ten dollars is not really worth doing.",
  },
];

const STEPS = [
  {
    title: "Type a handle",
    body: "Any X handle. You do not need their address, their number, or their permission.",
  },
  {
    title: "Send the money",
    body: "It goes straight away if they are here. If they are not, it waits, and nobody else can touch it.",
  },
  {
    title: "They sign in",
    body: "One tap and it is theirs. No app to download, nothing to write down, nothing to set up.",
  },
];

const FEATURES: { icon: LucideIcon; title: string; body: string; span: string }[] = [
  {
    icon: AtSign,
    title: "Pay a name, not a code",
    body: "Type the handle you already know them by. Nothing to copy, nothing to paste wrong, nothing to check twice before you press send.",
    span: "lg:col-span-4",
  },
  {
    icon: Clock,
    title: "Money that waits",
    body: "Paying someone who has never heard of us works exactly the same. It waits until they sign in.",
    span: "lg:col-span-2",
  },
  {
    icon: Users,
    title: "Pay a whole list at once",
    body: "Five people, one screen, one confirmation.",
    span: "lg:col-span-2",
  },
  {
    icon: Undo2,
    title: "Take it back",
    body: "Wrong person, or they never turned up? Unclaimed money comes back to you in full.",
    span: "lg:col-span-2",
  },
  {
    icon: Banknote,
    title: "Cash out",
    body: "Move it on to an account you already use whenever you want it out.",
    span: "lg:col-span-2",
  },
];

const SIDES = [
  {
    eyebrow: "If you are sending",
    title: "You need one thing: their handle",
    points: [
      "No address to ask them for",
      "No waiting for them to sign up",
      "Take it back if they never claim it",
      "See exactly where every payment got to",
    ],
  },
  {
    eyebrow: "If you are getting paid",
    title: "You need nothing at all",
    points: [
      "Nothing to download",
      "Nothing to write down or keep safe",
      "Sign in the way you always do",
      "Anything sent before you joined is already there",
    ],
  },
];

export default function Landing() {
  const { status, signIn, problem } = useAuth();

  // Someone with an account came for their wallet, not the pitch.
  if (status === "ready" || status === "needs-account") return <Redirect to="/wallet/home" />;

  // `loading` deliberately falls through to the page. The landing is the one
  // screen that must render before we know who is looking at it: a spinner here
  // would mean an empty page for anyone arriving from a link or a search.

  return (
    <>
      <Nav />

      <main>
        {/* ---------- hero ---------- */}
        <section className="relative overflow-hidden">
          <span
            className="lp-halo left-1/2 top-[-14rem] h-[26rem] w-[46rem] -translate-x-1/2 bg-gold/[0.13]"
            aria-hidden="true"
          />
          <div className="mx-auto w-full max-w-6xl px-5 pb-20 pt-10 sm:px-8 sm:pt-16 lg:pb-24">
            <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
              <div>
                <Reveal>
                  <span className="lp-pill">
                    <span className="h-1.5 w-1.5 rounded-full bg-gold pulse-dot" />
                    They need no app, no account, no anything
                  </span>

                  <h1 className="lp-h1 text-balance mt-6 text-ivory">
                    Send money to <span className="text-gold-grad">anyone</span> with a handle.
                  </h1>

                  <p className="lp-lead text-balance mt-6 max-w-xl">
                    Type their handle, pick an amount, send. There is nothing for them to download
                    and nothing for you to set up. If they have not joined yet, the money simply
                    waits until they do.
                  </p>
                </Reveal>

                <Reveal delay={110}>
                  <div className="mt-9 flex flex-wrap items-center gap-3">
                    <button
                      onClick={signIn}
                      disabled={status === "loading"}
                      className="btn btn-gold"
                    >
                      Get started <ArrowRight size={17} strokeWidth={2.5} />
                    </button>
                    <a href="#how" className="lp-ghost">
                      See how it works
                    </a>
                  </div>

                  <p className="mt-5 flex items-center gap-2 text-[14px] font-medium text-ivory/45">
                    <Zap size={14} strokeWidth={2.4} className="text-gold/70" />
                    Continue with Google or X. Free to open, takes one tap.
                  </p>

                  {problem && (
                    <p className="mt-5 flex max-w-md items-start gap-2.5 rounded-xl border border-gold/25 bg-gold/[0.08] p-3.5 text-[14px] leading-relaxed text-ivory/80">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-gold" />
                      {problem}
                    </p>
                  )}
                </Reveal>
              </div>

              <Reveal delay={200} variant="pop" className="pb-10 lg:pb-0">
                <SendCard />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ---------- proof strip ---------- */}
        <section className="border-y border-ivory/[0.08] bg-ivory/[0.015]">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-px overflow-hidden px-5 sm:px-8 lg:grid-cols-4">
            {PROOF.map((item, index) => (
              <Reveal key={item.caption} delay={index * 90}>
                <div className="py-8 text-center lg:py-10">
                  <p className="font-display text-[1.75rem] font-bold tracking-tight text-ivory sm:text-4xl">
                    {item.figure}
                  </p>
                  <p className="mt-1.5 text-[13.5px] font-medium text-ivory/45">{item.caption}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---------- the problem ---------- */}
        <section className="relative py-16 sm:py-24">
          <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
            <Reveal>
              <p className="eyebrow">The way it works now</p>
              <h2 className="lp-h2 text-balance mt-4 max-w-2xl text-ivory">
                Sending someone money still asks far too much of both of you.
              </h2>
            </Reveal>

            <div className="mt-12 grid gap-5 sm:grid-cols-3">
              {PAINS.map((pain, index) => (
                <Reveal key={pain.title} delay={index * 110} variant="pop">
                  <div className="lp-card lp-lift h-full p-7">
                    <span className="grid h-11 w-11 place-items-center rounded-xl border border-[#b91c34]/25 bg-[#b91c34]/10 text-[#e07185]">
                      <pain.icon size={19} strokeWidth={2.2} />
                    </span>
                    <p className="lp-h3 mt-5 text-ivory">{pain.title}</p>
                    <p className="mt-2.5 text-[15px] leading-relaxed text-ivory/55">{pain.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- how it works ---------- */}
        <section id="how" className="relative scroll-mt-24 py-16 sm:py-24">
          <div className="lp-grid-bg absolute inset-0 -z-10" aria-hidden="true" />
          <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
            <Reveal>
              <div className="text-center">
                <p className="eyebrow">How it works</p>
                <h2 className="lp-h2 text-balance mx-auto mt-4 max-w-2xl text-ivory">
                  Three steps, and only one of them is yours.
                </h2>
              </div>
            </Reveal>

            <div className="relative mt-14 grid gap-6 sm:grid-cols-3">
              {/* The thread the three steps hang from. Decorative, desktop only:
                  on a stacked phone layout a horizontal line joins nothing. */}
              <span
                className="absolute left-[16.6%] right-[16.6%] top-7 hidden h-px bg-gradient-to-r from-transparent via-gold/45 to-transparent sm:block"
                aria-hidden="true"
              />
              {STEPS.map((step, index) => (
                <Reveal key={step.title} delay={index * 130}>
                  <div className="relative text-center">
                    <span className="relative z-10 mx-auto grid h-14 w-14 place-items-center rounded-full border border-gold/30 bg-sea-deep font-display text-lg font-bold text-gold">
                      {index + 1}
                    </span>
                    <p className="lp-h3 mt-6 text-ivory">{step.title}</p>
                    <p className="mx-auto mt-2.5 max-w-xs text-[15px] leading-relaxed text-ivory/55">
                      {step.body}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- what you can do ---------- */}
        <section id="features" className="scroll-mt-24 py-16 sm:py-24">
          <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
            <Reveal>
              <p className="eyebrow">What you can do</p>
              <h2 className="lp-h2 text-balance mt-4 max-w-2xl text-ivory">
                Everything you would expect, and the part nobody else does.
              </h2>
            </Reveal>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-6">
              {FEATURES.map((feature, index) => (
                <Reveal
                  key={feature.title}
                  delay={index * 90}
                  variant="pop"
                  className={feature.span}
                >
                  <div className="lp-card lp-lift h-full p-7">
                    <span className="grid h-11 w-11 place-items-center rounded-xl border border-gold/25 bg-gold/[0.12] text-gold">
                      <feature.icon size={19} strokeWidth={2.2} />
                    </span>
                    <p className="lp-h3 mt-5 text-ivory">{feature.title}</p>
                    <p className="mt-2.5 text-[15px] leading-relaxed text-ivory/55">
                      {feature.body}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- both sides ---------- */}
        <section className="py-16 sm:py-24">
          <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
            <div className="grid gap-5 lg:grid-cols-2">
              {SIDES.map((side, index) => (
                <Reveal key={side.eyebrow} delay={index * 130} variant={index ? "right" : "left"}>
                  <div className="lp-card h-full p-8 sm:p-10">
                    <p className="eyebrow">{side.eyebrow}</p>
                    <p className="lp-h2 mt-4 text-[1.6rem] leading-tight text-ivory sm:text-[2rem]">
                      {side.title}
                    </p>
                    <ul className="mt-7 space-y-3.5">
                      {side.points.map((point) => (
                        <li key={point} className="flex items-start gap-3">
                          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#2f7d3f]/18 text-[#5fbf74]">
                            <Check size={12} strokeWidth={3} />
                          </span>
                          <span className="text-[15px] leading-relaxed text-ivory/65">{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- questions ---------- */}
        <section id="faq" className="scroll-mt-24 py-16 sm:py-24">
          <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
            <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
              <Reveal>
                <div className="lg:sticky lg:top-28">
                  <p className="eyebrow">Questions</p>
                  <h2 className="lp-h2 text-balance mt-4 text-ivory">
                    The things people ask first.
                  </h2>
                  <p className="lp-lead mt-5 max-w-sm">
                    Still wondering about something? The docs go into far more detail than this
                    page has room for.
                  </p>
                  <a href="/docs" className="lp-ghost mt-7">
                    Read the docs <ArrowRight size={16} strokeWidth={2.5} />
                  </a>
                </div>
              </Reveal>

              <Reveal delay={120}>
                <Faq />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ---------- the close ----------
            The one place on the page that spends the brand's loudest surface.
            It only reads as an event because nothing above it did. */}
        <section className="pb-4 pt-8">
          <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
            <Reveal variant="pop">
              <div className="chunk-gold relative overflow-hidden px-7 py-14 text-center sm:px-12 sm:py-16">
                <h2 className="lp-h2 text-balance mx-auto max-w-2xl text-pen">
                  Your money, at a name people already know you by.
                </h2>
                <p className="text-balance mx-auto mt-5 max-w-lg text-[16px] leading-relaxed text-pen/70">
                  No addresses to copy. Nothing to install. Just a handle and an amount.
                </p>
                <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={signIn}
                    disabled={status === "loading"}
                    className="btn btn-dark"
                  >
                    Open your wallet <ArrowRight size={17} strokeWidth={2.5} />
                  </button>
                </div>
                <p className="mt-5 text-[13.5px] font-semibold text-pen/55">
                  Free to open. One tap with Google or X.
                </p>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
