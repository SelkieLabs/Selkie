"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ArrowUp, Check, Copy, Lightbulb } from "lucide-react";
import { Footer, Header, Shell } from "@/components/Layout";
import { Reveal } from "@/components/Reveal";
import { useAuth } from "@/contexts/useAuth";
import { SECTIONS, type Block, type Section } from "./content";

/**
 * The documentation.
 *
 * Written for somebody who has never used a wallet and does not want to learn
 * what one is, so it explains what happens rather than how it works. Nothing on
 * this page is a technical reference. The two audiences want opposite things and
 * the one that pays money to a handle is the one being served here.
 *
 * Laid out as a reading column with the map beside it, because a long page with
 * no visible structure is a page people scroll once and leave. The sidebar
 * always shows where you are, and on a phone it collapses to a strip of pills
 * that scrolls sideways rather than eating the screen.
 *
 * Every section carries a mark. Nine near-identical cream panels are hard to
 * navigate by memory, and a shape beside each heading is what makes the one
 * about posting on X findable on the way back to it.
 */
export default function Docs() {
  const { status, signIn } = useAuth();
  const here = useCurrentSection();

  return (
    <>
      <Header />

      <main>
        <Shell wide>
          <section className="pb-9 pt-12 sm:pt-16">
            <Reveal>
              <p className="eyebrow">Documentation</p>
              <h1 className="text-balance mt-4 max-w-2xl font-display text-[2.3rem] font-bold leading-[1.08] tracking-tight text-ivory sm:text-5xl">
                How Selkie works
              </h1>
              <p className="text-balance mt-5 max-w-xl text-lg leading-relaxed text-ivory/70">
                Everything you can do, in plain language. It should take about five minutes to read
                the whole thing.
              </p>
            </Reveal>

            <Reveal delay={110}>
              <Shortcuts />
            </Reveal>
          </section>

          <div className="flex flex-col gap-8 pb-8 lg:flex-row lg:items-start lg:gap-12">
            <Sidebar here={here} />

            <div className="min-w-0 flex-1 space-y-5">
              {SECTIONS.map((section) => (
                <Article key={section.id} section={section} />
              ))}

              <Reveal>
                <section className="chunk-gold flex flex-col items-center gap-5 p-9 text-center">
                  <h2 className="text-balance max-w-md font-display text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
                    That is the whole of it. Try sending someone a dollar.
                  </h2>
                  <button onClick={signIn} disabled={status === "loading"} className="btn btn-dark">
                    Open your wallet <ArrowRight size={17} strokeWidth={2.5} />
                  </button>
                </section>
              </Reveal>
            </div>
          </div>
        </Shell>
      </main>

      <Footer />
    </>
  );
}

/**
 * The three places most people are actually going.
 *
 * A sidebar of nine entries is a map, not a recommendation. This is the
 * recommendation, and it sits above the fold where somebody deciding whether to
 * read any of this will see it.
 */
function Shortcuts() {
  const picks = ["getting-started", "on-x", "questions"] as const;

  return (
    <div className="mt-9 grid gap-3.5 sm:grid-cols-3">
      {picks.map((id) => {
        const section = SECTIONS.find((candidate) => candidate.id === id);
        if (!section) return null;

        return (
          <a key={id} href={`#${id}`} className="chunk chunk-pop flex items-center gap-3.5 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-pen bg-gold/[0.3] text-pen">
              <section.icon size={18} strokeWidth={2.2} />
            </span>
            <span className="min-w-0">
              <span className="block font-display text-[15px] font-bold leading-tight tracking-tight">
                {section.title}
              </span>
              <span className="mt-0.5 block truncate text-[13px] text-pen/55">{section.lead}</span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

/**
 * The map, and where you are on it.
 *
 * Sticky on a wide screen so it stays put through a long read. On a narrow one
 * it becomes a single row that scrolls sideways: a vertical list of nine links
 * above the text would push the first paragraph off the bottom of a phone.
 */
function Sidebar({ here }: { here: string }) {
  return (
    <div className="sticky top-16 z-30 -mx-5 shrink-0 border-y border-ivory/[0.07] bg-sea-deep/80 px-5 py-3 backdrop-blur-xl lg:top-24 lg:mx-0 lg:w-56 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
      <nav aria-label="On this page">
        <p className="mb-3 hidden text-[11px] font-bold uppercase tracking-[0.14em] text-ivory/40 lg:block">
          On this page
        </p>

        <ul className="flex gap-2 overflow-x-auto [scrollbar-width:none] lg:flex-col lg:gap-0.5 lg:overflow-visible [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map((section) => {
            const active = section.id === here;
            return (
              <li key={section.id} className="shrink-0 lg:shrink">
                <a
                  href={`#${section.id}`}
                  aria-current={active ? "true" : undefined}
                  className={`flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-[13.5px] font-semibold transition-colors lg:rounded-none lg:rounded-r-lg lg:border-l-2 lg:whitespace-normal ${
                    active
                      ? "bg-gold/[0.14] text-gold-light lg:border-gold"
                      : "text-ivory/55 hover:bg-ivory/[0.05] hover:text-ivory/90 lg:border-ivory/10"
                  }`}
                >
                  <section.icon
                    size={15}
                    strokeWidth={2.2}
                    className={`shrink-0 ${active ? "" : "opacity-55"}`}
                  />
                  {section.title}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Ten sections down, the header is the only way back and it is a long
          way up. Hidden on a phone, where the strip above is already the map. */}
      <a
        href="#top"
        onClick={(event) => {
          event.preventDefault();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        className="mt-4 hidden items-center gap-2 px-3 text-[12.5px] font-semibold text-ivory/40 transition-colors hover:text-ivory/80 lg:flex"
      >
        <ArrowUp size={14} strokeWidth={2.4} /> Back to top
      </a>
    </div>
  );
}

function Article({ section }: { section: Section }) {
  return (
    <Reveal>
      {/* The heading is the scroll target, offset so the sticky header does not
          land on top of it when a sidebar link jumps here. */}
      <section className="chunk scroll-mt-32 p-7 sm:p-9" id={section.id}>
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-pen bg-gold/[0.3] text-pen">
            <section.icon size={20} strokeWidth={2.2} />
          </span>
          <div className="min-w-0 pt-0.5">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-[1.7rem]">
              {section.title}
            </h2>
            {section.lead && (
              <p className="mt-1.5 text-[15px] font-semibold leading-relaxed text-gold-ink">
                {section.lead}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {section.blocks.map((block, index) => (
            <Piece key={index} block={block} />
          ))}
        </div>
      </section>
    </Reveal>
  );
}

function Piece({ block }: { block: Block }) {
  if (block.p) {
    return <p className="text-[15.5px] leading-[1.75] text-pen/75">{block.p}</p>;
  }

  if (block.note) {
    return (
      <p className="flex gap-3 rounded-2xl border-2 border-pen/[0.12] bg-gold/[0.13] px-4 py-3.5 text-[15px] font-semibold leading-relaxed text-pen/80">
        <Lightbulb size={17} strokeWidth={2.2} className="mt-0.5 shrink-0 text-gold-ink" />
        {block.note}
      </p>
    );
  }

  if (block.steps) {
    return (
      <ol className="space-y-3">
        {block.steps.map((step, index) => (
          <li key={step} className="flex gap-3.5 text-[15.5px] leading-[1.65] text-pen/75">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-pen bg-gold/[0.35] font-display text-[12px] font-bold text-pen">
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    );
  }

  if (block.list) {
    return (
      <ul className="space-y-3">
        {block.list.map((item) => (
          <li key={item} className="flex gap-3.5 text-[15.5px] leading-[1.65] text-pen/75">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-pen bg-gold/[0.35] text-pen">
              <Check size={13} strokeWidth={3.2} />
            </span>
            {item}
          </li>
        ))}
      </ul>
    );
  }

  if (block.commands) {
    return (
      <div className="divide-y-2 divide-pen/[0.09] overflow-hidden rounded-2xl border-2 border-pen/[0.15]">
        {block.commands.map((command) => (
          <CommandRow key={command.type} type={command.type} does={command.does} />
        ))}
      </div>
    );
  }

  if (block.qa) {
    return (
      <dl className="space-y-4">
        {block.qa.map(({ q, a }) => (
          <div key={q} className="border-l-2 border-gold/60 pl-4">
            <dt className="font-display text-[16px] font-bold leading-snug tracking-tight text-pen">
              {q}
            </dt>
            <dd className="mt-1.5 text-[15.5px] leading-[1.7] text-pen/70">{a}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return null;
}

/**
 * One command, with a button that puts it on the clipboard.
 *
 * Every line here is meant to end up in a post. Retyping "@SelkiePay request 5
 * from @friend" by hand is where a typo comes from, and a typo in this list is
 * a payment that does not happen.
 */
function CommandRow({ type, does }: { type: string; does: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(type);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // No clipboard permission. The text is selectable either way, so there is
      // nothing useful to say and an error here would only be noise.
    }
  };

  return (
    <div className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-pen/[0.04] sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
        <code className="font-mono text-[13.5px] font-semibold text-pen sm:w-[18.5rem] sm:shrink-0">
          {type}
        </code>
        <span className="text-[14.5px] leading-snug text-pen/65">{does}</span>
      </div>

      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : `Copy "${type}"`}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border-2 transition-all ${
          copied
            ? "border-pen bg-gold/[0.45] text-pen"
            : "border-pen/15 text-pen/45 hover:border-pen/40 hover:text-pen"
        }`}
      >
        {copied ? <Check size={14} strokeWidth={3} /> : <Copy size={14} strokeWidth={2.4} />}
      </button>
    </div>
  );
}

/**
 * Which section the reader is looking at.
 *
 * Chosen as the last heading to have crossed the top of the screen rather than
 * whichever one is most visible. Picking by visibility makes the marker jump
 * back and forth over a short section on the way past, which reads as a bug.
 */
function useCurrentSection(): string {
  const [here, setHere] = useState(SECTIONS[0]?.id ?? "");

  useEffect(() => {
    const pick = () => {
      // A quarter of the way down: far enough below the sticky header that a
      // heading counts as "arrived" when the reader can actually see it.
      const line = window.innerHeight * 0.25;
      let current = SECTIONS[0]?.id ?? "";

      for (const section of SECTIONS) {
        const top = document.getElementById(section.id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= line) current = section.id;
      }

      // At the very bottom nothing further can cross the line, so the last
      // section would never light up on a page that ends in short ones.
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 80) {
        current = SECTIONS.at(-1)?.id ?? current;
      }
      setHere(current);
    };

    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, []);

  return here;
}
