"use client";

import { ArrowRight, ArrowUpRight, Check, Download, Minus } from "lucide-react";
import { Mark, Wordmark } from "@/components/Mark";
import { Reveal } from "@/components/Reveal";

const CONTRACT = "CBQ54MQWSN32HX26QG2IJ2OFD2IKJBAPAHTDTV43TDUOSQWMO4V2CX5Y";
const EXPLORER = `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`;

/** The three things an investor checks before reading anything else. */
const STANDING = [
  { term: "Live now", detail: "selkiepay.com, Stellar testnet, end to end" },
  { term: "On chain", detail: "Escrow contract deployed, claims verifiable" },
  { term: "Stage", detail: "Pre-mainnet, raising a first angel round" },
];

/** The argument, in order. Drives the sticky rail and the print bookmarks. */
const SECTIONS = [
  { id: "problem", label: "The problem" },
  { id: "today", label: "What works today" },
  { id: "mechanism", label: "How it works" },
  { id: "moat", label: "Why nobody else has it" },
  { id: "market", label: "The market" },
  { id: "status", label: "Where we are" },
  { id: "next", label: "Where this goes" },
  { id: "ask", label: "The ask" },
];

const WORKING = [
  "Send to any X handle, from the web app",
  "Money held in escrow for someone with no account",
  "Claim on first sign-in, all of it in one transaction",
  "Refund in full if nobody ever claims it",
  "Sign in with Google or X, wallet created for you",
  "Every fee and reserve paid by us, never by the user",
];

const PENDING = [
  "Cash out — the flow is built, no provider wired yet",
  "The X bot — works, deliberately held in dry run",
  "Telegram — backend is done, no front end yet",
  "Mainnet — testnet only, and that is what the raise is for",
  "Users — none. We have not launched.",
];

const ASK = [
  {
    term: "A first angel check",
    detail: "To get from testnet to mainnet, and to pay for the launch that follows it.",
  },
  {
    term: "Pitch preparation and intros",
    detail: "The testnet app is the demo. We want it in front of the right people.",
  },
  {
    term: "Marketing and product",
    detail: "The two roles we do not have, and the two we feel the absence of weekly.",
  },
  {
    term: "A validator",
    detail: "Run through Noders once the check is in.",
  },
];

export default function Pitch() {
  return (
    <>
      {/* ---------- header ---------- */}
      <header className="print-hide sticky top-0 z-50 border-b border-ivory/[0.08] bg-sea-deep/70 py-3.5 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <Wordmark />
          <div className="flex items-center gap-2.5">
            <button onClick={() => window.print()} className="lp-ghost h-10 px-4 text-[14px]">
              <Download size={15} strokeWidth={2.4} />
              <span className="hidden sm:inline">Download PDF</span>
              <span className="sm:hidden">PDF</span>
            </button>
            <a
              href="https://selkiepay.com"
              className="btn btn-gold btn-sm"
              target="_blank"
              rel="noreferrer"
            >
              Open the app <ArrowRight size={15} strokeWidth={2.6} />
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
          {/* ---------- the spine ----------
              A pitch is read in order, so the rail is a map of the argument
              rather than navigation chrome. Desktop only: on a phone it would
              push the thing people came to read below the fold. */}
          <nav className="print-hide hidden lg:block">
            <ul className="sticky top-28 space-y-1 border-l border-ivory/10 py-1">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="-ml-px block border-l border-transparent py-1.5 pl-4 text-[13.5px] font-medium text-ivory/40 transition-colors hover:border-gold/60 hover:text-ivory/85"
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <article className="min-w-0 pb-24">
            {/* ---------- hero ---------- */}
            <section className="relative pb-14 pt-12 sm:pt-20">
              <span
                className="lp-halo left-0 top-[-12rem] h-[24rem] w-[38rem] bg-gold/[0.12] print-hide"
                aria-hidden="true"
              />
              <Reveal>
                <span className="lp-pill">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-gold" />
                  Live on Stellar testnet
                </span>

                <h1 className="lp-h1 text-balance mt-7 max-w-[20ch] text-ivory">
                  The money is there before they are.
                </h1>

                <p className="lp-lead mt-7 max-w-[62ch]">
                  Selkie lets you pay someone by their handle alone. No address, no app, no seed
                  phrase, no gas — and it works even when the person you are paying has never heard
                  of us. The money waits for them, and it is in their balance the moment they sign
                  in.
                </p>
              </Reveal>

              <Reveal delay={110}>
                <div className="mt-9 flex flex-wrap items-center gap-3 print-hide">
                  <a
                    href="https://selkiepay.com"
                    className="btn btn-gold"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Try the live app <ArrowRight size={17} strokeWidth={2.5} />
                  </a>
                  <button onClick={() => window.print()} className="lp-ghost">
                    <Download size={16} strokeWidth={2.4} />
                    Save as PDF
                  </button>
                </div>

                {/* The standing ledger: facts, set as facts, not as stat tiles. */}
                <dl className="mt-11 border-t border-ivory/[0.1]">
                  {STANDING.map((item) => (
                    <div
                      key={item.term}
                      className="flex flex-col gap-0.5 border-b border-ivory/[0.1] py-3.5 sm:flex-row sm:gap-8"
                    >
                      <dt className="w-32 shrink-0 text-[14px] font-bold text-gold">{item.term}</dt>
                      <dd className="text-[15px] text-ivory/65">{item.detail}</dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
            </section>

            {/* ---------- the problem ---------- */}
            <Section id="problem" eyebrow="The problem" title="Paying a person is still the hardest easy thing on the internet.">
              <p>
                To pay someone today you need a 56-character address off them, or you need them to
                go and make an account first — pick a password, save twelve words, keep them
                somewhere safe forever. For two people sending each other twenty dollars, that is an
                absurd amount of ceremony, and the fees take a bite out of the twenty on the way
                through.
              </p>
              <p>
                So the money does not move that way. It moves as cash, as airtime, as a screenshot
                on WhatsApp and a promise. Every product that has tried to fix this has fixed the
                wrong half: they make the <em>sender</em> type a name instead of an address, but the
                recipient still has to already exist somewhere. That is the half that actually
                blocks people.
              </p>
            </Section>

            {/* ---------- what works today ---------- */}
            <Section
              id="today"
              eyebrow="What works today"
              title="It is built, it is deployed, and you can use it in under a minute."
            >
              <p>
                Open <Link href="https://selkiepay.com">selkiepay.com</Link>, sign in with Google or
                X, type a handle and an amount. If that person is already here it lands in seconds.
                If they are not — if they have never heard of Selkie — the money is held for them,
                and the moment they sign in with that handle it is already in their balance.
              </p>
              <p>
                The escrow contract is deployed on Stellar testnet and the deposit and claim
                transactions are public. The suite is green at 82 tests, attack cases included.
              </p>
              <p className="not-prose">
                <Link href={EXPLORER}>
                  <code className="num break-all text-[13px]">
                    {CONTRACT}
                  </code>
                </Link>
              </p>
            </Section>

            {/* ---------- the mechanism ----------
                The one loud thing on the page. Everything else is set quietly
                so this reads as the centre of the argument, because it is. */}
            <Section
              id="mechanism"
              eyebrow="How it works"
              title="The money is held by a contract, not by us."
            >
              <p>
                A payment is addressed to a hash of the handle, so it does not need a wallet to
                point at. It sits in a contract we deployed but cannot spend, and it leaves in
                exactly one of two directions.
              </p>

              <Reveal variant="pop" className="not-prose my-10">
                <Flow />
              </Reveal>

              <p>
                We cannot take it, we cannot freeze it, and we cannot stop a refund. The only power
                we hold is attesting that a person signed in with the handle a payment was addressed
                to — and even that can only ever route money to that person. Sign in once and
                everything sent to you while you were away arrives in a single transaction.
              </p>
            </Section>

            {/* ---------- the moat ---------- */}
            <Section
              id="moat"
              eyebrow="Why nobody else has it"
              title="The existing primitives all need a wallet that already exists."
            >
              <p>
                The obvious way to build this is a claimable balance, and it does not work: it has
                to name a real account at the moment you send. To use it you would have to create
                and fund an account for every handle anyone ever pays, hold the key yourself, and
                pay a locked reserve for every stranger who never shows up. That is custody with
                extra steps, and anyone can run your costs up by paying a cent to random handles.
              </p>
              <p>
                The other obvious way is a hashlock, and it is worse: it turns the secret into a
                bearer instrument. Whoever learns it takes the money. Our delivery channel is a
                public post, so the secret cannot travel with the payment — which means we would
                hold it, which means we could spend it.
              </p>
              <p>
                Holding funds against a hashed handle and binding the destination at claim time is
                the only shape that pays a stranger without becoming their custodian. It took the
                longest to build and it is the piece everything else hangs off.
              </p>
            </Section>

            {/* ---------- market ---------- */}
            <Section
              id="market"
              eyebrow="The market"
              title="Emerging markets first, and Nigeria before anywhere else."
            >
              <p>
                The people who need this are already moving money informally every day, already pay
                each other by name, and already lose a slice of every transfer to fees and spread.
                They are not waiting for a better wallet. They are waiting for something that works
                like the way they already behave.
              </p>
              <p>
                The feature that closes the loop is cash out to local money — Naira, mobile money —
                because that is what turns a balance into something people trust. It is the last
                thing we build, deliberately, and the first thing we will be judged on.
              </p>
            </Section>

            {/* ---------- honest status ---------- */}
            <Section
              id="status"
              eyebrow="Where we are"
              title="What is real, and what is not, with nothing rounded up."
            >
              <p>
                Pitches get believed on the second list, not the first. Both of these are current as
                of today.
              </p>
              <div className="not-prose mt-9 grid gap-x-12 gap-y-10 sm:grid-cols-2">
                <Ledger title="Working now" items={WORKING} tone="on" />
                <Ledger title="Not yet" items={PENDING} tone="off" />
              </div>
            </Section>

            {/* ---------- where it goes ---------- */}
            <Section
              id="next"
              eyebrow="Where this goes"
              title="One product, built to land on more than one chain."
            >
              <p>
                Chain-specific code lives in exactly one adapter package; everything else — handles,
                money, the payment flow — talks to an interface and knows nothing about any ledger.
                Stellar is the adapter that is live. A second chain is an adapter and a line of
                registration, not a rewrite, and that was a deliberate decision made early rather
                than a story told afterwards.
              </p>
              <p>
                It matters because of one thing we cannot fix on a public ledger. Every balance and
                every payment on Stellar is visible forever, to anyone, which means we cannot
                honestly promise anyone privacy there — so we do not. A privacy-preserving ledger
                such as Canton gives that back: the same handle, the same one tap, with balances
                that are nobody else&rsquo;s business. &ldquo;Pay anyone by the name you already
                know them by, and nobody can see what you hold&rdquo; is a product no transparent
                chain can ship, and it is the version of Selkie we want to exist.
              </p>
            </Section>

            {/* ---------- the ask ---------- */}
            <Section id="ask" eyebrow="The ask" title="What we are looking for.">
              <dl className="not-prose mt-2 border-t border-ivory/[0.1]">
                {ASK.map((item) => (
                  <div key={item.term} className="border-b border-ivory/[0.1] py-5">
                    <dt className="lp-h3 text-ivory">{item.term}</dt>
                    <dd className="mt-1.5 text-[15.5px] leading-relaxed text-ivory/60">
                      {item.detail}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>

            {/* ---------- close ---------- */}
            <section className="mt-20 border-t border-ivory/[0.1] pt-10">
              <div className="flex flex-wrap items-end justify-between gap-6">
                <div>
                  <span className="flex items-center gap-2.5">
                    <Mark size={22} />
                    <span className="font-display text-lg font-bold tracking-tight text-ivory">
                      Selkie Labs
                    </span>
                  </span>
                  <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-ivory/50">
                    Money that finds people. Send to a handle and it gets there, whether or not they
                    have ever heard of us.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 text-[15px]">
                  <Link href="https://selkiepay.com">selkiepay.com</Link>
                  <Link href="https://x.com/SelkiePay">x.com/SelkiePay</Link>
                  <Link href="https://github.com/SelkieLabs/Selkie">github.com/SelkieLabs/Selkie</Link>
                </div>
              </div>
            </section>
          </article>
        </div>
      </main>
    </>
  );
}

/* ---------- pieces ---------- */

/**
 * One movement of the argument. The eyebrow and heading are set once here so
 * every section is spaced and scaled identically down the page — a pitch that
 * drifts in rhythm reads as less considered than one that does not.
 */
function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="pitch-section scroll-mt-24 border-t border-ivory/[0.1] py-14 sm:py-16">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="lp-h2 text-balance mt-4 max-w-[22ch] text-ivory">{title}</h2>
      <div className="pitch-prose mt-7 max-w-[64ch]">{children}</div>
    </section>
  );
}

/** A list where every row is a claim we are willing to be held to. */
function Ledger({ title, items, tone }: { title: string; items: string[]; tone: "on" | "off" }) {
  const on = tone === "on";
  return (
    <div>
      <p className={`lp-h3 ${on ? "text-gold" : "text-ivory/45"}`}>{title}</p>
      <ul className="mt-5 space-y-3.5">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-[15.5px] leading-relaxed text-ivory/70">
            <span
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                on
                  ? "border-gold/35 bg-gold/15 text-gold"
                  : "border-ivory/15 bg-ivory/[0.05] text-ivory/35"
              }`}
              aria-hidden="true"
            >
              {on ? <Check size={11} strokeWidth={3.2} /> : <Minus size={11} strokeWidth={3.2} />}
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The escrow, drawn. Three states and the two exits, laid out left to right on
 * a wide screen and top to bottom on a narrow one — the connectors rotate with
 * the grid rather than being drawn into a fixed-size image.
 */
function Flow() {
  return (
    <div className="lp-card p-6 sm:p-8">
      <div className="grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1.15fr_auto_1fr]">
        <Node label="Sender" body="Types a handle and an amount." />
        <Connector caption="pays" />
        <Node
          label="The contract"
          body="Holds the money against a hash of the handle. Not a Selkie wallet."
          lit
        />
        <Connector caption="on first sign-in" />
        <Node label="Recipient" body="Had no wallet, no account, no idea. Now has the money." />
      </div>

      <div className="mt-7 flex items-start gap-3 border-t border-ivory/10 pt-5 text-[14px] leading-relaxed text-ivory/50">
        <span
          className="mt-0.5 shrink-0 text-gold/70"
          aria-hidden="true"
        >
          &larr;
        </span>
        <p>
          <span className="font-semibold text-ivory/75">If nobody ever claims it</span>, the sender
          takes it back in full, and no permission from us is involved. Money can wait. It cannot
          get stuck.
        </p>
      </div>
    </div>
  );
}

function Node({ label, body, lit = false }: { label: string; body: string; lit?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        lit ? "border-gold/30 bg-gold/[0.07]" : "border-ivory/10 bg-ivory/[0.03]"
      }`}
    >
      <p className={`lp-h3 ${lit ? "text-gold-light" : "text-ivory"}`}>{label}</p>
      <p className="mt-2 text-[14px] leading-relaxed text-ivory/55">{body}</p>
    </div>
  );
}

function Connector({ caption }: { caption: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-1 sm:flex-col sm:py-0">
      <span className="h-px w-8 bg-gradient-to-r from-transparent to-gold/50 sm:h-8 sm:w-px sm:bg-gradient-to-b" />
      <span className="whitespace-nowrap text-[12.5px] font-semibold text-gold/75">{caption}</span>
      <span className="h-px w-8 bg-gradient-to-r from-gold/50 to-transparent sm:h-8 sm:w-px sm:bg-gradient-to-b" />
    </div>
  );
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-baseline gap-0.5 font-semibold text-gold underline decoration-gold/30 underline-offset-[3px] transition-colors hover:decoration-gold"
    >
      {children}
      <ArrowUpRight size={13} strokeWidth={2.6} className="shrink-0 self-center opacity-60" />
    </a>
  );
}
