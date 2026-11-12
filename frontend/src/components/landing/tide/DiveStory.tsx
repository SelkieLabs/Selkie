"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { XLogo } from "@/components/Mark";
import { NEAR_NETWORK } from "@/lib/chain";
import { Caustics } from "./Caustics";
import { Chest, Kelp, Motes } from "./Sea";

const NET = NEAR_NETWORK === "mainnet" ? "near" : "testnet";

const STEPS = [
  {
    n: "01 · 0 m",
    title: "You send $25 to @amaka",
    body: "Type their handle and an amount. You sign once, and Selkie pays the fee.",
    meta: "from your NEAR account",
  },
  {
    n: "02 · −40 m",
    title: "It waits for @amaka",
    body: "Held in escrow, keyed to their X account rather than the name. Someone who takes the name later can't claim it.",
    meta: `escrow.selkiepay.${NET}`,
  },
  {
    n: "03 · −40 m",
    title: "@amaka signs in with X",
    body: "Their key is made in their browser when they sign in. Selkie never sees it.",
    meta: "no wallet, no seed phrase",
  },
  {
    n: "04 · 0 m",
    title: `It's theirs, in amaka.x.selkiepay.${NET}`,
    body: "A real NEAR account named after their handle, with the $25 already in it.",
    meta: "one key, and it's theirs",
  },
];

const PATH = "M156,111 C156,300 300,400 468,400 L780,400 C948,400 1092,320 1092,200";
const TRAIL = 9;

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
/** 0 → 1 as p runs from a to b. */
const span = (p: number, a: number, b: number) => clamp((p - a) / (b - a));

/** Which of the four steps a point in the dive belongs to. */
function stepAt(p: number) {
  return p < 0.3 ? 0 : p < 0.62 ? 1 : p < 0.86 ? 2 : 3;
}

/**
 * How it works, as a dive. The section pins while you scroll through it, and
 * the $25 follows the dotted path: down from the surface into the escrow chest
 * at −40 m, held there until @amaka signs in with X, then back up into their
 * pass. Scroll drives all of it, so it runs as fast or slow as the reader.
 * Reduced motion shows the finished picture and all four steps, unpinned.
 */
export function DiveStory() {
  const pin = useRef<HTMLDivElement>(null);
  const scaleBox = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const path = useRef<SVGPathElement>(null);
  const drawn = useRef<SVGPathElement>(null);
  const coin = useRef<HTMLSpanElement>(null);
  const trail = useRef<HTMLSpanElement[]>([]);
  const amount = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [flags, setFlags] = useState({ chestOpen: false, chestGlow: false, signedIn: false, home: false, d1: false, d2: false, d3: false, d4: false });

  // The coin's x in scene pixels, so the phone camera can follow it.
  const coinX = useRef(156);

  // Fit the fixed 1248 × 486 scene to the column. On a wide screen the whole
  // scene shows. On a phone it would be a thin strip, so the camera zooms in to
  // the box's height and pans with the coin instead.
  const frame = useRef(() => {
    const box = scaleBox.current;
    const sc = scene.current;
    if (!box || !sc) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    const zoom = Math.max(w / 1248, h / 486);
    const maxPan = Math.max(0, 1248 * zoom - w);
    const pan = Math.min(maxPan, Math.max(0, coinX.current * zoom - w / 2));
    sc.style.transform = `translate3d(${-pan}px,0,0) scale(${zoom})`;
  });

  useEffect(() => {
    const box = scaleBox.current;
    if (!box) return;
    const fit = frame.current;
    const ro = new ResizeObserver(() => fit());
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const p0 = path.current;
    const el = pin.current;
    if (!p0 || !el) return;
    const L = p0.getTotalLength();
    // where the path passes the chest (x ≈ 612), found once
    let atChest = L * 0.5;
    for (let i = 0; i <= 300; i++) {
      const d = (L * i) / 300;
      if (p0.getPointAtLength(d).x >= 612 && p0.getPointAtLength(d).y > 390) {
        atChest = d;
        break;
      }
    }
    if (drawn.current) drawn.current.style.strokeDasharray = `0 ${L}`;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let lastStep = -1;
    let lastFlags = "";

    const render = (p: number) => {
      // distance of the coin along the path
      let dist: number;
      let show = 1;
      if (p < 0.1) {
        dist = 0;
        show = span(p, 0.015, 0.07);
      } else if (p < 0.4) dist = atChest * ease(span(p, 0.1, 0.4));
      else if (p < 0.7) {
        dist = atChest;
        show = p < 0.44 ? 1 - span(p, 0.4, 0.44) : span(p, 0.66, 0.7);
      } else if (p < 0.92) dist = atChest + (L - atChest) * ease(span(p, 0.7, 0.92));
      else {
        dist = L;
        show = 1 - span(p, 0.92, 0.95);
      }
      if (reduced) show = 0;

      const pt = p0.getPointAtLength(dist);
      coinX.current = pt.x;
      frame.current();
      const drop = p < 0.1 ? (1 - span(p, 0.015, 0.07)) * -36 : 0;
      if (coin.current) {
        coin.current.style.transform = `translate(${pt.x}px, ${pt.y + drop}px) scale(${0.7 + show * 0.3})`;
        coin.current.style.opacity = String(show);
      }
      const moving = (p > 0.1 && p < 0.4) || (p > 0.7 && p < 0.92);
      trail.current.forEach((t, i) => {
        if (!t) return;
        const tp = p0.getPointAtLength(Math.max(0, dist - (i + 1) * 16));
        const size = 7 - i * 0.5;
        t.style.width = t.style.height = `${size}px`;
        t.style.transform = `translate(${tp.x - size / 2}px, ${tp.y - size / 2}px)`;
        t.style.opacity = moving && !reduced ? String(0.75 - i * 0.075) : "0";
      });
      if (drawn.current) drawn.current.style.strokeDasharray = `${reduced ? L : dist} ${L}`;
      if (amount.current) {
        const v = reduced ? 25 : 25 * span(p, 0.9, 0.97);
        amount.current.textContent = `$${v.toFixed(2)}`;
      }

      const s = reduced ? 3 : stepAt(p);
      if (s !== lastStep) {
        lastStep = s;
        setStep(s);
      }
      const f = reduced
        ? { chestOpen: false, chestGlow: false, signedIn: true, home: true, d1: true, d2: true, d3: true, d4: true }
        : {
            chestOpen: (p > 0.36 && p < 0.45) || (p > 0.64 && p < 0.73),
            chestGlow: p > 0.42 && p < 0.7,
            signedIn: p > 0.6,
            home: p > 0.9,
            d1: p > 0.015,
            d2: p > 0.4,
            d3: p > 0.62,
            d4: p > 0.92,
          };
      const key = JSON.stringify(f);
      if (key !== lastFlags) {
        lastFlags = key;
        setFlags(f);
      }
    };

    if (reduced) {
      render(1);
      return;
    }

    let raf = 0;
    const read = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const run = r.height - window.innerHeight;
      render(run > 0 ? clamp(-r.top / run) : 0);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section id="how" className="td-how" data-depth="-10" aria-labelledby="how-title">
      <div id="dive" className="td-pin" ref={pin}>
        <div className="td-pin-stick">
          <div className="td-inner" style={{ width: "100%" }}>
            <div className="head">
              <div>
                <div className="td-depth">−10 m · how it works</div>
                <h2 id="how-title" className="td-h2 td-words">
                  {["How", "it", "finds"].map((w, i) => (
                    <span key={w} className="td-word" style={{ "--i": i } as CSSProperties}>
                      <span>{w}&nbsp;</span>
                    </span>
                  ))}
                  <span className="td-word" style={{ "--i": 3 } as CSSProperties}>
                    <span>
                      <em>them.</em>
                    </span>
                  </span>
                </h2>
              </div>
              <p className="td-lede">
                Four steps, and only the first one is yours. Keep scrolling and follow the $25 down
                to where it waits, then back up.
              </p>
            </div>

            <div className="td-dive-box" aria-hidden="true">
              <div className="td-dive-scale" ref={scaleBox}>
                <div className="td-dive" ref={scene}>
                  <Caustics tile={260} top={0.9} bottom={0} falloff={1.4} seed={21.4} scale={0.5} />
                  <div className="sand" />
                  <Motes count={34} seed={11} top={24} />
                  <Kelp
                    width={160}
                    height={200}
                    style={{ left: 0 }}
                    fill="#06141d"
                    blade="#071721"
                    strands={[
                      [30, 190, 10, 0.6, 18],
                      [72, 130, 8, 2.1, 14],
                      [112, 90, 7, 1.2, 10],
                    ]}
                  />
                  <Kelp
                    width={180}
                    height={170}
                    style={{ right: 0 }}
                    fill="#06141d"
                    blade="#071721"
                    strands={[
                      [150, 160, 10, 1.9, 16],
                      [110, 110, 8, 0.4, 12],
                      [60, 80, 7, 2.8, 9],
                    ]}
                  />
                  <span className={`td-beam${flags.signedIn ? " on" : ""}`} style={{ left: 720, width: 120 }} />
                  <div className="td-waterfront" />
                  <svg className="ln" width="1248" height="486" viewBox="0 0 1248 486">
                    <path
                      d="M0,111 C60,105 120,117 180,111 S300,105 360,111 S480,117 540,111 S660,105 720,111 S840,117 900,111 S1020,105 1080,111 S1200,117 1248,111"
                      fill="none"
                      stroke="rgba(233,241,236,.55)"
                      strokeWidth="1.5"
                    />
                    <path
                      ref={path}
                      d={PATH}
                      fill="none"
                      stroke="rgba(127,209,185,.45)"
                      strokeWidth="2"
                      strokeDasharray="2 9"
                      strokeLinecap="round"
                    />
                    <path
                      ref={drawn}
                      d={PATH}
                      fill="none"
                      stroke="rgba(217,164,65,.55)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="dl" style={{ top: 111 }}>
                    0 m
                  </span>
                  <span className="dl" style={{ top: 256 }}>
                    −20 m
                  </span>
                  <span className="dl" style={{ top: 400 }}>
                    −40 m
                  </span>

                  <div className="td-sendpill">
                    <span className="td-av-sm">A</span>
                    <b>@amaka</b>
                    <span className="m">$25.00</span>
                  </div>
                  <span className={`td-dot4${flags.d1 ? " on" : ""}`} style={{ left: 156, top: 111 }} />
                  <span className={`td-dot4${flags.d2 ? " on" : ""}`} style={{ left: 468, top: 400 }} />
                  <span className={`td-dot4${flags.d3 ? " on" : ""}`} style={{ left: 780, top: 400 }} />
                  <span className={`td-dot4${flags.d4 ? " on" : ""}`} style={{ left: 1092, top: 200 }} />
                  <span className="td-dlab" style={{ left: 186, top: 126 }}>
                    01
                  </span>
                  <span className="td-dlab" style={{ left: 468, top: 416 }}>
                    02
                  </span>
                  <span className="td-dlab" style={{ left: 780, top: 416 }}>
                    03
                  </span>
                  <span className="td-dlab" style={{ left: 1124, top: 214 }}>
                    04
                  </span>

                  {Array.from({ length: TRAIL }, (_, i) => (
                    <span
                      key={i}
                      className="td-trail"
                      ref={(n) => {
                        if (n) trail.current[i] = n;
                      }}
                    />
                  ))}
                  <Chest
                    open={flags.chestOpen}
                    glow={flags.chestGlow}
                    style={{ position: "absolute", left: 578, top: 358, zIndex: 4, transform: "scale(.62)", transformOrigin: "left top" }}
                  />
                  <span className="td-coin" ref={coin} style={{ opacity: 0 }}>
                    $
                  </span>

                  <span className={`td-xchip${flags.signedIn ? " on" : ""}`}>
                    <XLogo size={14} />
                    @amaka signed in
                  </span>

                  <div className={`td-mpass${flags.home ? " on" : ""}`}>
                    <div className="hole" />
                    <div className="av">A</div>
                    <div className="n">@amaka</div>
                    <div className="hh">amaka.x.selkiepay</div>
                    <div className="am" ref={amount}>
                      $0.00
                    </div>
                  </div>
                  <span className={`td-ripple${flags.home ? " on" : ""}`} style={{ left: 990, top: 103, width: 210, height: 16 }} />
                  <span
                    className={`td-ripple${flags.home ? " on" : ""}`}
                    style={{ left: 960, top: 99, width: 270, height: 24, animationDelay: "-1.2s" }}
                  />
                </div>
              </div>
            </div>

            <ol className="td-steps">
              {STEPS.map((s, i) => (
                <li key={s.n} className={`td-step${i <= step ? " on" : ""}${i === step ? " now" : ""}`}>
                  <div className="n">{s.n}</div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                  <div className="meta">{s.meta}</div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
