"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, Download, Minus } from "lucide-react";
import { Mark, Wordmark } from "@/components/Mark";

const CONTRACT = "CBQ54MQWSN32HX26QG2IJ2OFD2IKJBAPAHTDTV43TDUOSQWMO4V2CX5Y";
const EXPLORER = `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`;

const SLIDES = [
  "Selkie",
  "The problem",
  "What works today",
  "How it works",
  "Why nobody else has it",
  "The market",
  "Where we are",
  "Where this goes",
  "The ask",
];

const STANDING = [
  { term: "Live now", detail: "selkiepay.com, Stellar testnet, end to end" },
  { term: "On chain", detail: "Escrow contract deployed, claims verifiable" },
  { term: "Stage", detail: "Pre-mainnet, raising a first angel round" },
];

const WORKING = [
  "Send to any X handle from the web app",
  "Money held for someone with no account",
  "Claim on first sign-in, all of it at once",
  "Refund in full if nobody claims it",
  "Sign in with Google or X, wallet made for you",
  "Every fee and reserve paid by us",
];

const PENDING = [
  "Cash out — built, no provider wired",
  "The X bot — works, held in dry run",
  "Telegram — backend done, no front end",
  "Mainnet — testnet only so far",
  "Users — none. We have not launched.",
];

const ASK = [
  { term: "A first angel check", detail: "Testnet to mainnet, and the launch after it." },
  { term: "Intros", detail: "The app is the demo. We want it in front of the right people." },
  { term: "Marketing and product", detail: "The two roles we do not have." },
  { term: "A validator", detail: "Run through Noders once the check is in." },
];

export default function Pitch() {
  const here = useActiveSlide();

  return (
    <div className="pdk">
      {/* ---------- chrome ---------- */}
      <header className="print-hide fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-4 px-5 py-4 sm:px-8">
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
      </header>

      {/* ---------- the film strip ----------
          One dot per slide, so the deck says how long it is and where you are
          in it without costing a column of the screen. */}
      <nav className="print-hide fixed right-5 top-1/2 z-50 hidden -translate-y-1/2 flex-col items-end gap-3 lg:flex">
        {SLIDES.map((label, i) => (
          <a
            key={label}
            href={`#s${i}`}
            className="group flex items-center gap-2.5"
            aria-label={label}
            aria-current={here === i ? "true" : undefined}
          >
            <span
              className={`whitespace-nowrap text-[12.5px] font-semibold transition-colors ${
                here === i ? "text-gold" : "text-ivory/40 group-hover:text-ivory/75"
              }`}
            >
              {label}
            </span>
            <span
              className={`h-[3px] rounded-full transition-all duration-300 ${
                here === i ? "w-7 bg-gold" : "w-3 bg-ivory/30 group-hover:bg-ivory/55"
              }`}
            />
          </a>
        ))}
      </nav>

      {/* ---------- 1. title ---------- */}
      <Slide index={0}>
        <span className="lp-pill">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-gold" />
          Live on Stellar testnet
        </span>
        <h1 className="pdk-h1 text-balance mt-7 max-w-[16ch] text-ivory">
          The money is there before they are.
        </h1>
        <p className="pdk-lead mt-7 max-w-[54ch]">
          Pay anyone by their handle alone. No address, no app, no seed phrase, no gas — and it
          works even when the person you are paying has never heard of us.
        </p>
        <dl className="mt-11 max-w-2xl border-t border-ivory/[0.12]">
          {STANDING.map((item) => (
            <div
              key={item.term}
              className="flex flex-col gap-0.5 border-b border-ivory/[0.12] py-3 sm:flex-row sm:gap-8"
            >
              <dt className="w-32 shrink-0 text-[14px] font-bold text-gold">{item.term}</dt>
              <dd className="pdk-dd text-[15px]">{item.detail}</dd>
            </div>
          ))}
        </dl>
      </Slide>

      {/* ---------- 2. problem ---------- */}
      <Slide index={1} eyebrow="The problem">
        <h2 className="pdk-h2 text-balance max-w-[18ch] text-ivory">
          Paying a person is still the hardest easy thing on the internet.
        </h2>
        <div className="pdk-body mt-8 max-w-[58ch] space-y-5">
          <p>
            To pay someone you need a 56-character address off them, or you need them to go and make
            an account first — a password, twelve words, kept safe forever. For two people sending
            each other twenty dollars that is an absurd amount of ceremony, and the fees take a bite
            out of the twenty on the way through.
          </p>
          <p>
            Every product that has tried to fix this fixed the wrong half. They let the sender type
            a name instead of an address, but the recipient still has to already exist. That is the
            half that actually blocks people.
          </p>
        </div>
      </Slide>

      {/* ---------- 3. today ---------- */}
      <Slide index={2} eyebrow="What works today">
        <h2 className="pdk-h2 text-balance max-w-[18ch] text-ivory">
          Built, deployed, and usable in under a minute.
        </h2>
        <div className="pdk-body mt-8 max-w-[58ch] space-y-5">
          <p>
            Open <A href="https://selkiepay.com">selkiepay.com</A>, sign in with Google or X, type a
            handle and an amount. If that person is here it lands in seconds. If they have never
            heard of Selkie, the money is held for them — and it is already in their balance the
            moment they sign in.
          </p>
          <p>
            The escrow contract is deployed on Stellar testnet. The deposit and claim transactions
            are public. 82 tests green, attack cases included.
          </p>
        </div>
        <p className="mt-7">
          <A href={EXPLORER}>
            <code className="num break-all text-[12.5px]">{CONTRACT}</code>
          </A>
        </p>
      </Slide>

      {/* ---------- 4. mechanism ---------- */}
      <Slide index={3} eyebrow="How it works">
        <h2 className="pdk-h2 text-balance max-w-[18ch] text-ivory">
          The money is held by a contract, not by us.
        </h2>
        <div className="mt-9 grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1.15fr_auto_1fr]">
          <Node label="Sender" body="Types a handle and an amount." />
          <Connector caption="pays" />
          <Node
            label="The contract"
            body="Holds it against a hash of the handle. Not a Selkie wallet."
            lit
          />
          <Connector caption="on first sign-in" />
          <Node label="Recipient" body="Had no wallet, no account, no idea. Now has the money." />
        </div>
        <p className="pdk-body mt-8 max-w-[58ch]">
          We cannot take it, freeze it, or stop a refund. Our only power is attesting that someone
          signed in with the handle a payment was addressed to — and that can only ever route money
          to that person. If nobody claims it, the sender takes it back in full. Money can wait; it
          cannot get stuck.
        </p>
      </Slide>

      {/* ---------- 5. moat ---------- */}
      <Slide index={4} eyebrow="Why nobody else has it">
        <h2 className="pdk-h2 text-balance max-w-[18ch] text-ivory">
          The existing primitives all need a wallet that already exists.
        </h2>
        <div className="pdk-body mt-8 max-w-[58ch] space-y-5">
          <p>
            <Strong>A claimable balance</Strong> has to name a real account at the moment you send.
            You would have to create and fund an account for every handle anyone pays, hold the key
            yourself, and lock a reserve for every stranger who never shows up. That is custody with
            extra steps, and anyone can run your costs up by paying a cent to random handles.
          </p>
          <p>
            <Strong>A hashlock</Strong> is worse: it makes the secret a bearer instrument. Whoever
            learns it takes the money. Our delivery channel is a public post, so the secret cannot
            travel with the payment — meaning we would hold it, meaning we could spend it.
          </p>
          <p>
            Holding funds against a hashed handle and binding the destination at claim time is the
            only shape that pays a stranger without becoming their custodian.
          </p>
        </div>
      </Slide>

      {/* ---------- 6. market ---------- */}
      <Slide index={5} eyebrow="The market">
        <h2 className="pdk-h2 text-balance max-w-[18ch] text-ivory">
          Emerging markets first, and Nigeria before anywhere else.
        </h2>
        <div className="pdk-body mt-8 max-w-[58ch] space-y-5">
          <p>
            The people who need this already move money informally every day, already pay each other
            by name, and already lose a slice of every transfer to fees and spread. They are not
            waiting for a better wallet. They are waiting for something that works the way they
            already behave.
          </p>
          <p>
            Cash out to local money — Naira, mobile money — is what closes the loop and turns a
            balance into something people trust. It is the last thing we build, deliberately, and
            the first thing we will be judged on.
          </p>
        </div>
      </Slide>

      {/* ---------- 7. status ---------- */}
      <Slide index={6} eyebrow="Where we are">
        <h2 className="pdk-h2 text-balance max-w-[20ch] text-ivory">
          What is real, and what is not, with nothing rounded up.
        </h2>
        <div className="mt-10 grid gap-x-14 gap-y-9 sm:grid-cols-2">
          <Ledger title="Working now" items={WORKING} on />
          <Ledger title="Not yet" items={PENDING} />
        </div>
      </Slide>

      {/* ---------- 8. next ---------- */}
      <Slide index={7} eyebrow="Where this goes">
        <h2 className="pdk-h2 text-balance max-w-[18ch] text-ivory">
          One product, built to land on more than one chain.
        </h2>
        <div className="pdk-body mt-8 max-w-[58ch] space-y-5">
          <p>
            Chain-specific code lives in exactly one adapter. Handles, money and the payment flow
            talk to an interface and know nothing about any ledger. Stellar is the adapter that is
            live; a second chain is an adapter and a line of registration, not a rewrite.
          </p>
          <p>
            That matters because of one thing we cannot fix on a public ledger. Every balance on
            Stellar is visible forever, so we cannot honestly promise anyone privacy there — and we
            do not. A privacy-preserving ledger gives it back: same handle, same one tap, balances
            that are nobody else&rsquo;s business. That is a product no transparent chain can ship.
          </p>
        </div>
      </Slide>

      {/* ---------- 9. ask ---------- */}
      <Slide index={8} eyebrow="The ask">
        <h2 className="pdk-h2 text-balance max-w-[14ch] text-ivory">What we are looking for.</h2>
        <dl className="mt-9 max-w-3xl border-t border-ivory/[0.12]">
          {ASK.map((item) => (
            <div
              key={item.term}
              className="flex flex-col gap-1 border-b border-ivory/[0.12] py-4 sm:flex-row sm:gap-10"
            >
              <dt className="w-56 shrink-0 font-display text-[1.0625rem] font-bold tracking-tight text-gold">
                {item.term}
              </dt>
              <dd className="pdk-dd text-[15.5px] leading-relaxed">{item.detail}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-12 flex flex-wrap items-end justify-between gap-8">
          <span className="flex items-center gap-2.5">
            <Mark size={22} />
            <span className="font-display text-lg font-bold tracking-tight text-ivory">
              Selkie Labs
            </span>
          </span>
          <div className="flex flex-col gap-1 text-[15px]">
            <A href="https://selkiepay.com">selkiepay.com</A>
            <A href="https://x.com/SelkiePay">x.com/SelkiePay</A>
          </div>
        </div>
      </Slide>
    </div>
  );
}

/* ---------- pieces ---------- */

/** One screen of the deck. Fills the viewport, snaps, and prints as one page. */
function Slide({
  index,
  eyebrow,
  children,
}: {
  index: number;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={`s${index}`} className="pdk-slide" data-slide={index}>
      <div className="pdk-stage">
        {eyebrow && <p className="eyebrow mb-5">{eyebrow}</p>}
        {children}
      </div>
      <span className="pdk-num" aria-hidden="true">
        {String(index + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}
      </span>
    </section>
  );
}

function Ledger({ title, items, on = false }: { title: string; items: string[]; on?: boolean }) {
  return (
    <div>
      <p className={`font-display text-[1.0625rem] font-bold tracking-tight ${on ? "text-gold" : "pdk-dim"}`}>
        {title}
      </p>
      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <li key={item} className="pdk-dd flex gap-3 text-[15.5px] leading-relaxed">
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

function Node({ label, body, lit = false }: { label: string; body: string; lit?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        lit ? "border-gold/30 bg-gold/[0.07]" : "border-ivory/10 bg-ivory/[0.03]"
      }`}
    >
      <p
        className={`font-display text-[1.0625rem] font-bold tracking-tight ${
          lit ? "text-gold-light" : "text-ivory"
        }`}
      >
        {label}
      </p>
      <p className="pdk-dd mt-2 text-[14px] leading-relaxed">{body}</p>
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

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-ivory/90">{children}</strong>;
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
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

/**
 * Which slide is on screen, for the strip, plus arrow-key paging. A deck that
 * does not answer the arrow keys feels like a web page pretending to be one.
 */
function useActiveSlide() {
  const [here, setHere] = useState(0);

  useEffect(() => {
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".pdk-slide"));
    if (!slides.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setHere(Number(entry.target.getAttribute("data-slide")));
        }
      },
      { threshold: 0.55 },
    );
    slides.forEach((slide) => io.observe(slide));

    const onKey = (event: KeyboardEvent) => {
      const step = event.key === "ArrowDown" || event.key === "PageDown" ? 1 : event.key === "ArrowUp" || event.key === "PageUp" ? -1 : 0;
      if (!step) return;
      const target = document.querySelector<HTMLElement>(`[data-slide="${currentOf(slides) + step}"]`);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth" });
    };
    window.addEventListener("keydown", onKey);

    return () => {
      io.disconnect();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return here;
}

/** Read the live position off the DOM so the key handler never closes over a stale index. */
function currentOf(slides: HTMLElement[]) {
  const middle = window.innerHeight / 2;
  let best = 0;
  let nearest = Infinity;
  slides.forEach((slide, i) => {
    const box = slide.getBoundingClientRect();
    const distance = Math.abs(box.top + box.height / 2 - middle);
    if (distance < nearest) {
      nearest = distance;
      best = i;
    }
  });
  return best;
}
