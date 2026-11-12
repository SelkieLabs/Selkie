"use client";

import { BookOpen, Check, ExternalLink, Fuel, Layers, Lock, PenLine, X as Cross } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { XLogo } from "@/components/Mark";
import { NEAR_NETWORK } from "@/lib/chain";
import { explorer } from "@/lib/explorer";
import { Caustics } from "./Caustics";
import { HandleForm } from "./HandleForm";
import { useInView } from "./hooks";

const NET = NEAR_NETWORK === "mainnet" ? "near" : "testnet";

/**
 * A real account on testnet whose only key is its owner's. The proof section
 * links to it and shows what `npm run prove:keys` printed for it (12 Nov).
 */
const PROOF_ACCOUNT = "selkiepay.x.selkiepay.testnet";

/** The GitHub mark in lucide's line style (lucide dropped brand icons). */
function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

/** A section heading whose words rise out of a mask; `em` is the serif accent. */
function Heading({ id, words, em }: { id?: string; words: string; em?: string }) {
  const parts = words.split(" ").filter(Boolean);
  return (
    <h2 id={id} className="td-h2 td-words">
      {parts.map((w, i) => (
        <span key={`${w}${i}`} className="td-word" style={{ "--i": i } as CSSProperties}>
          <span>{w}&nbsp;</span>
        </span>
      ))}
      {em && (
        <span className="td-word" style={{ "--i": parts.length } as CSSProperties}>
          <span>
            <em>{em}</em>
          </span>
        </span>
      )}
    </h2>
  );
}

function Depth({ children }: { children: ReactNode }) {
  return <div className="td-depth">{children}</div>;
}

/* ---------------- proof ---------------- */

type Line = { text: string; cls?: "c" | "d" | "g" };
const TERMINAL: Line[] = [
  { text: `$ npm run prove:keys -- ${PROOF_ACCOUNT}`, cls: "c" },
  { text: "" },
  { text: `Account   ${PROOF_ACCOUNT}` },
  { text: "Keys      1 on chain" },
  { text: "  ed25519:5JduNAu…tgRv8AxCXM  full access", cls: "c" },
  { text: "Selkie    6 keys, all on Selkie's own accounts", cls: "d" },
  { text: "" },
  { text: "Result    Selkie holds no key to this account.", cls: "g" },
  { text: "          It cannot sign for it.", cls: "g" },
];

/** The proof run, typed out as it scrolls in: the command, then the answer, line by line. */
function Terminal() {
  const box = useRef<HTMLDivElement>(null);
  const seen = useInView(box, { once: true, margin: "0px 0px -20% 0px" });
  const [chars, setChars] = useState(0);
  const [lines, setLines] = useState(0);

  useEffect(() => {
    if (!seen) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setChars(TERMINAL[0].text.length);
      setLines(TERMINAL.length);
      return;
    }
    let c = 0;
    let l = 1;
    let timer = 0;
    const typeCmd = () => {
      c += 1;
      setChars(c);
      if (c < TERMINAL[0].text.length) timer = window.setTimeout(typeCmd, 26 + Math.random() * 30);
      else timer = window.setTimeout(nextLine, 420);
    };
    const nextLine = () => {
      l += 1;
      setLines(l);
      if (l < TERMINAL.length) timer = window.setTimeout(nextLine, l === 2 ? 380 : 150);
    };
    setLines(1);
    timer = window.setTimeout(typeCmd, 300);
    return () => window.clearTimeout(timer);
  }, [seen]);

  const done = lines >= TERMINAL.length;
  return (
    <div className="td-term" ref={box} data-td-reveal style={{ "--d": "120ms" } as CSSProperties}>
      <div className="tb">
        <i />
        <i />
        <i />
        <span>~/selkie</span>
      </div>
      <pre aria-label={TERMINAL.map((t) => t.text).join("\n")}>
        {TERMINAL.slice(0, Math.max(lines, 1)).map((line, i) => (
          <span key={i} className={line.cls} aria-hidden="true">
            {i === 0 ? line.text.slice(0, chars) : line.text}
            {i === 0 && lines <= 1 && <span className="cur" />}
            {"\n"}
          </span>
        ))}
        {done && <span className="cur" aria-hidden="true" />}
      </pre>
      <Caustics tile={180} rgb={[180, 235, 220]} top={0.8} bottom={0.1} falloff={1} seed={5.5} scale={0.4} speed={0.2} />
    </div>
  );
}

export function Proof() {
  return (
    <section id="proof" className="td-sec td-proof" data-depth="-20" aria-labelledby="proof-title">
      <Caustics tile={300} rgb={[127, 209, 185]} top={0.7} bottom={0} falloff={1.2} seed={9.2} scale={0.5} speed={0.25} />
      <div className="td-inner">
        <div>
          <Depth>−20 m · proof</Depth>
          <Heading id="proof-title" words="One account. One key." em="Theirs." />
          <p className="td-lede" data-td-reveal>
            Every Selkie account is a real NEAR account. Its only key is made in the owner&apos;s
            browser when they sign in. You can check it yourself, with no Selkie server involved.
          </p>
          <div className="td-stats" data-td-reveal style={{ "--d": "80ms" } as CSSProperties}>
            <div className="td-stat">
              <div className="big">1</div>
              <div className="lab">
                key on
                <b>
                  {PROOF_ACCOUNT.split(".").map((part, i) => (
                    <span key={i}>
                      {i > 0 && <wbr />}
                      {i > 0 ? "." : ""}
                      {part}
                    </span>
                  ))}
                </b>
              </div>
            </div>
            <div className="td-stat">
              <div className="big" style={{ color: "var(--sg)" }}>
                0
              </div>
              <div className="lab">
                keys Selkie holds
                <b>to it, read from the chain</b>
              </div>
            </div>
          </div>
          <a className="td-exp" href={explorer.account(PROOF_ACCOUNT)} target="_blank" rel="noreferrer">
            View it on the explorer <ExternalLink size={15} />
          </a>
        </div>
        <Terminal />
      </div>
    </section>
  );
}

/* ---------------- gas ---------------- */

const NODES = [
  { icon: PenLine, title: "You sign", body: "Send $25 to @amaka, and nothing else.", who: "your key, in your browser" },
  { icon: Fuel, title: "Relayer pays", body: "Wraps it and pays the network fee.", who: `relayer.selkiepay.${NET}`, hi: true },
  { icon: Layers, title: "NEAR runs it", body: "Exactly as you signed, or not at all.", who: "NEP-366 meta-transaction" },
];

export function Gas() {
  const ref = useRef<HTMLDivElement>(null);
  const on = useInView(ref);
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (!on || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setLit((v) => (v + 1) % 3), 1000);
    return () => window.clearInterval(id);
  }, [on]);

  return (
    <section className="td-sec td-gas" data-depth="-25" aria-labelledby="gas-title">
      <div className="td-inner">
        <div>
          <Depth>−25 m · fees</Depth>
          <Heading id="gas-title" words="Nobody pays" em="gas." />
          <p className="td-lede" data-td-reveal>
            You sign. Selkie&apos;s relayer pays the fee. It can&apos;t change what you signed, and
            it only relays payments the app prepared for you a moment before.
          </p>
        </div>
        <div ref={ref} data-td-reveal style={{ "--d": "100ms" } as CSSProperties}>
          <div className="td-flow">
            {NODES.map((n, i) => (
              <FlowNode key={n.title} {...n} lit={on && lit === i} arrow={i < NODES.length - 1} delay={i} />
            ))}
          </div>
          <div className="td-fee">
            <span>your network fee</span>
            <span className="fill" />
            <b>$0.00</b>
          </div>
        </div>
      </div>
    </section>
  );
}

function FlowNode({
  icon: Icon,
  title,
  body,
  who,
  hi,
  lit,
  arrow,
  delay,
}: (typeof NODES)[number] & { lit: boolean; arrow: boolean; delay: number }) {
  return (
    <>
      <div className={`td-node${hi ? " hi" : ""}${lit ? " lit" : ""}`}>
        <span className="ic">
          <Icon size={19} strokeWidth={2} />
        </span>
        <h4>{title}</h4>
        <p>{body}</p>
        <span className="who">{who}</span>
      </div>
      {arrow && (
        <span className="td-arr" style={{ "--d": `${delay}s` } as CSSProperties} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </span>
      )}
    </>
  );
}

/* ---------------- intents: the currents ---------------- */

type Chip = { b: string; s: string; bg: string; l: string };
const INS: Chip[] = [
  { b: "USDT", s: "on Tron", bg: "#c4302b", l: "T" },
  { b: "USDC", s: "on Base", bg: "#2c5ff6", l: "B" },
];
const OUTS: Chip[] = [
  { b: "USDC", s: "on Base", bg: "#2c5ff6", l: "B" },
  { b: "USDT", s: "on Tron", bg: "#c4302b", l: "T" },
  { b: "USDC", s: "on Solana", bg: "linear-gradient(135deg,#9945ff,#14f195)", l: "S" },
];

function Currents() {
  const host = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [still, setStill] = useState(false);
  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const wide = w >= 640;
  const H = wide ? 470 : 600;
  const cx = w / 2;
  const cy = wide ? 235 : 290;
  const R = wide ? 88 : 70;

  // chip anchor points, and the strands that run from them into the hub and out again
  const ins = wide ? INS.map((_, i) => ({ x: 0, y: [160, 330][i] })) : INS.map((_, i) => ({ x: w * [0.27, 0.73][i], y: 64 }));
  const outs = wide
    ? OUTS.map((_, i) => ({ x: w, y: [120, 245, 370][i] }))
    : OUTS.map((_, i) => ({ x: w * [0.17, 0.5, 0.83][i], y: 520 }));

  const paths: { d: string; main: boolean; dir: "in" | "out" }[] = [];
  for (const a of ins)
    for (const off of [-8, 0, 8]) {
      const d = wide
        ? `M172,${a.y + off} C${(172 + cx - R) / 2},${a.y + off} ${(172 + cx - R) / 2},${cy + off * 0.4} ${cx - R + 6},${cy + off * 0.4}`
        : `M${a.x + off},${a.y + 24} C${a.x + off},${(a.y + cy - R) / 2} ${cx + off * 0.4},${(a.y + cy - R) / 2} ${cx + off * 0.4},${cy - R + 6}`;
      paths.push({ d, main: off === 0, dir: "in" });
    }
  for (const b of outs)
    for (const off of [-8, 0, 8]) {
      const d = wide
        ? `M${cx + R - 6},${cy + off * 0.4} C${(cx + R + w - 172) / 2},${cy + off * 0.4} ${(cx + R + w - 172) / 2},${b.y + off} ${w - 172},${b.y + off}`
        : `M${cx + off * 0.4},${cy + R - 6} C${cx + off * 0.4},${(cy + R + b.y) / 2} ${b.x + off},${(cy + R + b.y) / 2} ${b.x + off},${b.y - 24}`;
      paths.push({ d, main: off === 0, dir: "out" });
    }

  return (
    <div className="td-currents" ref={host} style={{ height: H }} aria-label="Money flows in from Tron and Base, through your NEAR account, and out to Base, Tron or Solana.">
      {w > 0 && (
        <>
          <svg viewBox={`0 0 ${w} ${H}`} aria-hidden="true">
            {paths.map((p, i) => (
              <path key={i} d={p.d} fill="none" stroke={`rgba(127,209,185,${p.main ? 0.55 : 0.18})`} strokeWidth={p.main ? 1.6 : 1} />
            ))}
            {paths
              .filter((p) => p.main)
              .flatMap((p, i) =>
                [0, 1, 2].map((k) => (
                  <circle key={`${i}-${k}`} r="2.6" fill="#7fd1b9" style={{ filter: "drop-shadow(0 0 4px #7fd1b9)" }}>
                    {still ? null : (
                      <animateMotion dur="3.6s" repeatCount="indefinite" begin={`${-(k * 1.2 + i * 0.37).toFixed(2)}s`} path={p.d} />
                    )}
                  </circle>
                )),
              )}
          </svg>
          <span className="td-ccap" style={wide ? { left: 0, top: 40 } : { left: 0, top: 6 }}>
            Add money
          </span>
          <span className="td-ccap" style={wide ? { right: 0, top: 40 } : { right: 0, top: H - 22 }}>
            Cash out
          </span>
          {INS.map((c, i) => (
            <ChipBox key={`in${i}`} c={c} style={wide ? { left: 0, top: ins[i].y } : { left: ins[i].x, top: ins[i].y }} />
          ))}
          <div className="td-hub" style={{ left: cx, top: cy }}>
            <div>
              <div className="usd">USDC</div>
              <div className="acct">your account</div>
              <div className="net">on NEAR</div>
            </div>
          </div>
          {OUTS.map((c, i) => (
            <ChipBox key={`out${i}`} c={c} style={wide ? { right: 0, top: outs[i].y } : { left: outs[i].x, top: outs[i].y }} />
          ))}
          <span className="td-ccap" style={{ left: "50%", top: wide ? 438 : H - 52, transform: "translateX(-50%)" }}>
            via NEAR Intents · 1Click
          </span>
        </>
      )}
    </div>
  );
}

function ChipBox({ c, style }: { c: Chip; style: CSSProperties }) {
  return (
    <div className="td-chip" style={style}>
      <span className="lg" style={{ background: c.bg }}>
        {c.l}
      </span>
      <div>
        <b>{c.b}</b>
        <span>{c.s}</span>
      </div>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <div className="td-bullets">
      {items.map((t, i) => (
        <div key={t} data-td-reveal style={{ "--d": `${i * 80}ms` } as CSSProperties}>
          <i>
            <Check size={14} strokeWidth={2.6} />
          </i>
          <span>{t}</span>
        </div>
      ))}
    </div>
  );
}

export function Intents() {
  return (
    <section className="td-sec td-intents" data-depth="-30" aria-labelledby="intents-title">
      <div className="td-inner">
        <div>
          <Depth>−30 m · any chain</Depth>
          <Heading id="intents-title" words="Any chain in." em="Any chain out." />
          <p className="td-lede" data-td-reveal>
            Add money from USDT on Tron or USDC on Base. Cash out to the chain you use. NEAR
            Intents does the crossing.
          </p>
          <Bullets
            items={[
              "You see the quote before anything moves.",
              "If a swap fails, the money goes back to where it came from.",
              NEAR_NETWORK === "testnet"
                ? "On testnet you see live quotes only; crossings run on mainnet."
                : "Live on NEAR mainnet.",
            ]}
          />
        </div>
        <div data-td-reveal style={{ "--d": "120ms" } as CSSProperties}>
          <Currents />
        </div>
      </div>
    </section>
  );
}

/* ---------------- pay many ---------------- */

const LIST = [
  { h: "kofi", amt: 30, here: true },
  { h: "ife", amt: 30, here: true },
  { h: "amaka", amt: 40, here: false },
  { h: "tobi_dev", amt: 25, here: true },
  { h: "zainab", amt: 25, here: false },
];

export function PayMany() {
  const card = useRef<HTMLDivElement>(null);
  const seen = useInView(card, { once: true, margin: "0px 0px -25% 0px" });
  const [checked, setChecked] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setChecked(LIST.length);
      return;
    }
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setChecked(n);
      if (n >= LIST.length) window.clearInterval(id);
    }, 260);
    return () => window.clearInterval(id);
  }, [seen]);

  const total = LIST.slice(0, checked).reduce((s, r) => s + r.amt, 0);
  const waiting = LIST.slice(0, checked).filter((r) => !r.here).length;

  return (
    <section className="td-sec td-many" data-depth="-35" aria-labelledby="many-title">
      <div className="td-inner">
        <div>
          <Depth>−35 m · pay many</Depth>
          <Heading id="many-title" words="Pay a whole list" em="at once." />
          <p className="td-lede" data-td-reveal>
            Five contributors, one payment. People already on Selkie get it now. The rest find it
            waiting when they sign in.
          </p>
          <Bullets
            items={[
              "Paste handles and amounts, or a CSV.",
              "One signature and one transfer for the whole list.",
              "Works for a community treasury paying contributors by handle.",
            ]}
          />
        </div>
        <div className="td-card" ref={card} data-td-reveal style={{ "--d": "120ms" } as CSSProperties}>
          <div className="ch">
            <b>Pay many</b>
            <span>5 people · USDC</span>
          </div>
          {LIST.map((r, i) => {
            const done = i < checked;
            return (
              <div className="td-lr" key={r.h}>
                <span className={`av${r.here ? "" : " new"}`}>{r.h[0].toUpperCase()}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="t">@{r.h}</div>
                  <div className="s">{r.here ? `${r.h}.x.selkiepay.${NET}` : "not on NEAR yet"}</div>
                </div>
                {!done ? (
                  <span className="td-tag idle">checking</span>
                ) : r.here ? (
                  <span className="td-tag ok">
                    <Check size={12} strokeWidth={2.6} />
                    lands now
                  </span>
                ) : (
                  <span className="td-tag wait">waits for them</span>
                )}
                <span className="m">${r.amt.toFixed(2)}</span>
              </div>
            );
          })}
          <div className="cf">
            <div className="tot">
              Total · {waiting} will wait until they sign in
              <b>${total.toFixed(2)}</b>
            </div>
            <span className="td-btn td-btn-sg" aria-hidden="true">
              Sign and send
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- trust ---------------- */

const PARTS = [
  { who: "Relayer", acct: `relayer.selkiepay.${NET}`, can: "Pay the gas for what you signed.", cant: "Change what you signed." },
  { who: "Account creator", acct: `x.selkiepay.${NET}`, can: "Create your account with your key.", cant: "Add a key to it later." },
  {
    who: "Oracle",
    acct: `oracle.selkiepay.${NET}`,
    can: "Release waiting money to whoever proves the X login.",
    cant: "Take it, change the amount, or block a refund.",
  },
  {
    who: "Escrow",
    acct: `escrow.selkiepay.${NET}`,
    can: "Hold money for a handle until they sign in.",
    cant: "Keep it past expiry. The sender can take it back.",
  },
];

export function Trust() {
  return (
    <section className="td-sec td-trust" data-depth="-40" aria-labelledby="trust-title">
      <div className="td-inner">
        <div className="head">
          <div>
            <Depth>−40 m · the floor</Depth>
            <Heading id="trust-title" words="What Selkie can" em="and can't do." />
          </div>
          <p className="td-lede" data-td-reveal>
            Every part of Selkie has one job and a hard limit. Here they all are.
          </p>
        </div>
        <div className="td-tbl" role="table" aria-label="What each part of Selkie can and can't do">
          <div className="td-tr th" role="row">
            <div role="columnheader">part</div>
            <div role="columnheader">can</div>
            <div role="columnheader">can&apos;t</div>
          </div>
          {PARTS.map((p, i) => (
            <div className="td-tr" role="row" key={p.who} data-td-reveal style={{ "--d": `${i * 70}ms` } as CSSProperties}>
              <div className="who" role="cell">
                <b>{p.who}</b>
                <span>{p.acct}</span>
              </div>
              <div className="yes" role="cell">
                <Check size={18} strokeWidth={2.4} />
                {p.can}
              </div>
              <div className="no" role="cell">
                <Cross size={18} strokeWidth={2.4} />
                {p.cant}
              </div>
            </div>
          ))}
        </div>
        <div className="td-honest" data-td-reveal>
          <Lock size={20} />
          <span>
            <b>The honest part:</b> the oracle is a trust point, and Privy holds your key material.
            Money already in your account is out of Selkie&apos;s reach.
          </span>
        </div>
      </div>
    </section>
  );
}

/* ---------------- the surface ---------------- */

export function End() {
  const sec = useRef<HTMLElement>(null);
  const giant = useRef<HTMLDivElement>(null);

  // The wordmark rises out of the water as you reach the bottom.
  useEffect(() => {
    const el = sec.current;
    const g = giant.current;
    if (!el || !g || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const left = Math.min(1, Math.max(0, (r.bottom - window.innerHeight) / window.innerHeight));
      g.style.setProperty("--rise", left.toFixed(3));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", on, { passive: true });
    return () => {
      window.removeEventListener("scroll", on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="td-end" ref={sec} data-depth="0" aria-labelledby="end-title">
      <Caustics tile={300} rgb={[160, 230, 210]} top={0.05} bottom={0.95} falloff={1.4} reverse seed={17.9} />
      <span className="td-rayu" style={{ left: "18%", width: 150 }} />
      <span className="td-rayu" style={{ left: "62%", width: 220 }} />
      <div className="td-cta">
        <Depth>0 m · back at the surface</Depth>
        <Heading id="end-title" words="Send it. It finds" em="them." />
        <p className="td-lede" data-td-reveal>
          Anyone with an X handle can be paid today.
        </p>
        <div data-td-reveal style={{ "--d": "100ms", width: "100%", display: "flex", flexDirection: "column", alignItems: "center" } as CSSProperties}>
          <HandleForm example="tunde" />
        </div>
        <div className="td-built">
          <i />
          Built at NEAR HACKATHON · on NEAR {NEAR_NETWORK}
        </div>
      </div>
      <footer className="td-fbar">
        <span className="td-wm" style={{ fontSize: 22 }}>
          Selkie
        </span>
        <div className="links">
          <a href="https://github.com/SelkieLabs/Selkie" target="_blank" rel="noreferrer">
            <GithubMark /> GitHub
          </a>
          <a href="/docs">
            <BookOpen size={16} /> Docs
          </a>
          <a href="https://x.com/SelkiePay" target="_blank" rel="noreferrer">
            <XLogo size={14} /> X
          </a>
        </div>
        <span className="td-mono">Open source · MIT</span>
      </footer>
      <div className="td-giant" ref={giant} aria-hidden="true">
        Selkie
      </div>
    </section>
  );
}
