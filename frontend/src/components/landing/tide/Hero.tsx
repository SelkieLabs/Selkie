"use client";

import { AlertTriangle, ArrowDown, ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAuth } from "@/contexts/useAuth";
import { NEAR_NETWORK } from "@/lib/chain";
import { Caustics } from "./Caustics";
import { XLogo } from "@/components/Mark";
import { chapterScroll, previewAccount, scrollToY, setScrollLock, useInView } from "./hooks";
import { Kelp, Motes } from "./Sea";

const CHAPTERS = ["01 you send", "02 it waits", "03 they sign in", "04 it's theirs"];

const MENU = [
  { href: "#how", label: "How it works" },
  { href: "#proof", label: "Proof" },
  { href: "#chains", label: "Any chain" },
  { href: "#many", label: "Pay many" },
  { href: "#tweet", label: "Tweet to pay" },
  { href: "#trust", label: "What Selkie can't do" },
  { href: "#faq", label: "Questions" },
];

/**
 * The phone menu: a sheet of water that opens out of the burger and covers the
 * screen. The page under it stops scrolling while it is open; picking a place
 * closes it and glides there.
 */
function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signIn } = useAuth();

  useEffect(() => {
    if (!open) return;
    setScrollLock(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      setScrollLock(false);
    };
  }, [open, onClose]);

  const go = (href: string) => {
    onClose();
    const el = document.querySelector<HTMLElement>(href);
    // after the lock lifts, or Lenis ignores the request
    if (el) requestAnimationFrame(() => scrollToY(el.getBoundingClientRect().top + window.scrollY));
  };

  return (
    <div className={`td-menu${open ? " open" : ""}`} role="dialog" aria-modal="true" aria-label="Menu" inert={!open} data-lenis-prevent>
      <div className="td-menu-top">
        <span className="td-wm">Selkie</span>
        <button className="td-burger" onClick={onClose} aria-label="Close menu">
          <X size={22} />
        </button>
      </div>
      <ol className="td-menu-links">
        {MENU.map((m, i) => (
          <li key={m.href} style={{ "--i": i } as CSSProperties}>
            <a
              href={m.href}
              onClick={(e) => {
                e.preventDefault();
                go(m.href);
              }}
            >
              <span className="n">{String(i + 1).padStart(2, "0")}</span>
              {m.label}
              <ArrowRight size={20} className="go" />
            </a>
          </li>
        ))}
      </ol>
      <div className="td-menu-foot" style={{ "--i": MENU.length } as CSSProperties}>
        <button
          className="td-btn td-btn-sg"
          onClick={() => {
            onClose();
            signIn();
          }}
        >
          Open Selkie
        </button>
        <div className="td-menu-small">
          <a href="/docs">Docs</a>
          <a href="https://github.com/SelkieLabs/Selkie" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="https://x.com/SelkiePay" target="_blank" rel="noreferrer">
            X
          </a>
        </div>
      </div>
    </div>
  );
}

const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#proof", label: "Proof" },
  { href: "#chains", label: "Any chain" },
  { href: "#faq", label: "FAQ" },
  { href: "/docs", label: "Docs" },
];

/**
 * The desktop links, in a glass capsule. A sea-glass bubble slides under the
 * section you are reading, and over whichever link the pointer is on.
 */
function NavLinks({ active }: { active: string | null }) {
  const [hover, setHover] = useState<string | null>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const links = useRef<Record<string, HTMLAnchorElement | null>>({});

  useEffect(() => {
    const b = bubble.current;
    if (!b) return;
    const target = links.current[hover ?? active ?? ""];
    if (!target) {
      b.style.opacity = "0";
      return;
    }
    b.style.opacity = "1";
    b.style.width = `${target.offsetWidth}px`;
    b.style.transform = `translateX(${target.offsetLeft}px)`;
  }, [hover, active]);

  return (
    <div className="links" onMouseLeave={() => setHover(null)}>
      <span className="bubble" ref={bubble} aria-hidden="true" />
      {NAV_LINKS.map((l) => (
        <a
          key={l.href}
          href={l.href}
          ref={(el) => {
            links.current[l.href] = el;
          }}
          onMouseEnter={() => setHover(l.href)}
          onFocus={() => setHover(l.href)}
          onBlur={() => setHover(null)}
          aria-current={active === l.href ? "true" : undefined}
          className={active === l.href ? "on" : undefined}
        >
          {l.label}
        </a>
      ))}
    </div>
  );
}

function Nav() {
  const { signIn } = useAuth();
  const [active, setActive] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const close = useRef(() => setMenu(false)).current;
  const bar = useRef<HTMLElement>(null);

  // Fixed to the top. Past the first few pixels it turns to frosted water
  // (a class, so scrolling never re-renders React for it).
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const y = window.scrollY;
      el.classList.toggle("stuck", y > 24);
      // the section under the upper third of the screen lights its link
      const line = window.innerHeight * 0.35;
      let now: string | null = null;
      for (const l of NAV_LINKS) {
        if (!l.href.startsWith("#")) continue;
        const r = document.querySelector(l.href)?.getBoundingClientRect();
        if (r && r.top <= line && r.bottom > line) now = l.href;
      }
      setActive(now);
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
    <>
      <nav className="td-nav" aria-label="Main" ref={bar}>
        <div className="l">
          <span className="td-wm">Selkie</span>
        </div>
        <NavLinks active={active} />
        <div className="r">
          <button onClick={signIn} className="td-btn td-btn-sg td-open">
            Open Selkie
            <ArrowRight size={16} />
          </button>
          <button className="td-burger" onClick={() => setMenu(true)} aria-label="Open menu" aria-expanded={menu}>
            <Menu size={22} />
          </button>
        </div>
      </nav>
      {/* outside the nav: its backdrop-filter would trap a fixed child inside it */}
      <MenuSheet open={menu} onClose={close} />
    </>
  );
}

/**
 * The pass: what a handle becomes. It bobs in the water, tilts toward the
 * pointer, and wears whatever handle is being typed above it.
 */
function FloatingPass({ handle }: { handle: string }) {
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = card.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce), (pointer: coarse)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / window.innerWidth;
        const dy = (e.clientY - (r.top + r.height / 2)) / window.innerHeight;
        el.style.setProperty("--rx", `${(dx * 22).toFixed(2)}deg`);
        el.style.setProperty("--ry", `${(-dy * 16).toFixed(2)}deg`);
        el.style.setProperty("--gx", `${(50 + dx * 120).toFixed(1)}%`);
        el.style.setProperty("--gy", `${(40 + dy * 120).toFixed(1)}%`);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const shown = previewAccount(handle, NEAR_NETWORK) ? handle.toLowerCase() : "amaka";
  const account = previewAccount(shown, NEAR_NETWORK);

  return (
    <div className="td-stage" aria-hidden="true">
      <div className="td-pool" />
      <div className="td-pshadow" />
      <div className="td-pass-wrap">
        <div className="td-pass" ref={card}>
          <Caustics
            className="shade"
            tile={170}
            rgb={[20, 70, 80]}
            top={0.5}
            bottom={0.9}
            falloff={0.7}
            speed={0.22}
            seed={12}
            scale={0.5}
          />
          <div className="in">
            <div className="hole" />
            <div className="top">
              <span>Selkie pass</span>
              <span>№ 001</span>
            </div>
            {/* keyed, so each new handle rises into place */}
            <div className="av td-swap" key={`a${shown}`}>
              {shown.slice(0, 1).toUpperCase()}
            </div>
            <div className="name td-swap" key={`n${shown}`}>
              @{shown}
            </div>
            <div className="acct td-swap" key={`c${shown}`}>
              {account}
            </div>
            <div className="keys">
              <span>keys on this account</span>
              <span className="td-stamp">1 · theirs</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The chain is live: show the latest final block, ticking, while the hero is on screen. */
function LiveBlock({ active }: { active: boolean }) {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    // Only testnet has an RPC URL we have checked from here (the one prove:keys uses).
    if (NEAR_NETWORK !== "testnet" || !active) return;
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("https://test.rpc.fastnear.com", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "selkie", method: "block", params: { finality: "final" } }),
        });
        const json = (await res.json()) as { result?: { header?: { height?: number } } };
        const h = json.result?.header?.height;
        if (!stop && typeof h === "number") setHeight(h);
      } catch {
        // Offline or blocked: the label just shows the network.
      }
    };
    void tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [active]);

  return (
    <span className="block">
      {height !== null && <i aria-hidden="true" />}
      NEAR {NEAR_NETWORK}
      {height !== null && <> · block {height.toLocaleString("en-US")}</>}
    </span>
  );
}

// Handles the pass cycles through, so it shows "any handle" without a box to type in.
const PASS_HANDLES = ["amaka", "tunde", "kofi", "ife", "zainab"];

export function Hero() {
  const { problem, signIn } = useAuth();
  const [turn, setTurn] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const onScreen = useInView(ref);

  useEffect(() => {
    if (!onScreen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setTurn((t) => (t + 1) % PASS_HANDLES.length), 2600);
    return () => window.clearInterval(id);
  }, [onScreen]);
  const handle = PASS_HANDLES[turn];

  return (
    <header className="td-hero" ref={ref} data-depth="0">
      <div className="td-surface" />
      <span className="td-ray" style={{ left: "26%", width: 160 }} />
      <span className="td-ray" style={{ left: "44%", width: 90, opacity: 0.7, animationDelay: "-4s" }} />
      <span className="td-ray" style={{ left: "62%", width: 240, animationDelay: "-7s" }} />
      <span className="td-ray" style={{ left: "86%", width: 120, opacity: 0.6, animationDelay: "-2s" }} />
      <Caustics tile={320} top={0.95} bottom={0.04} falloff={1.7} seed={31.7} follow />
      <div className="td-seabed" />
      <Motes count={46} />
      <Kelp
        width={260}
        height={420}
        style={{ left: -20 }}
        strands={[
          [40, 400, 13, 0.2, 34],
          [92, 300, 11, 1.4, 26],
          [150, 210, 9, 2.4, 20],
          [12, 250, 10, 3.0, 18],
        ]}
      />
      <Kelp
        width={300}
        height={330}
        style={{ right: -30 }}
        strands={[
          [250, 320, 13, 1.1, 30],
          [196, 230, 11, 2.2, 24],
          [140, 160, 9, 0.5, 16],
          [282, 200, 9, 3.3, 14],
        ]}
      />

      <Nav />

      <div className="td-hero-grid">
        <div className="td-copy">
          <h1 className="td-words" aria-label="Pay any X handle.">
            {["Pay", "any"].map((w, i) => (
              <span key={w} className="td-word" style={{ "--i": i } as CSSProperties}>
                <span>{w}&nbsp;</span>
              </span>
            ))}
            <br />
            {["X", "handle."].map((w, i) => (
              <span key={w} className="td-word" style={{ "--i": i + 2 } as CSSProperties}>
                <span>{w}&nbsp;</span>
              </span>
            ))}
          </h1>
          <span className="myth td-serif" data-td-reveal style={{ "--d": "260ms" } as CSSProperties}>
            Money that finds its way home.
          </span>
          <p data-td-reveal style={{ "--d": "340ms" } as CSSProperties}>
            They need no wallet and no app. The money waits until they sign in with X.
          </p>
          <div data-td-reveal style={{ "--d": "420ms" } as CSSProperties}>
            <div className="td-cta-row">
              <button className="td-go" onClick={signIn}>
                <span className="sheen" aria-hidden="true" />
                <span className="x" aria-hidden="true">
                  <XLogo size={17} />
                </span>
                <span className="t">
                  <b>Get started</b>
                  <small>Sign in with X · free</small>
                </span>
                <span className="arr" aria-hidden="true">
                  <ArrowRight size={19} />
                </span>
              </button>
              <button className="td-btn td-btn-ghost td-howbtn" onClick={() => chapterScroll(0)}>
                See how it works
                <ArrowDown size={16} />
              </button>
            </div>
            {problem && (
              <p className="td-problem" role="alert">
                <AlertTriangle size={16} />
                {problem}
              </p>
            )}
            <div className="td-built">
              <i />
              Built at NEAR HACKATHON · on NEAR {NEAR_NETWORK}
            </div>
          </div>
        </div>

        <FloatingPass handle={handle} />
      </div>


      <div className="td-hfoot">
        <span className="scroll">
          <i aria-hidden="true" />
          scroll to dive
        </span>
        <div className="td-chapters">
          {CHAPTERS.map((c, i) => (
            <button key={c} className={i === 0 ? "on" : ""} onClick={() => chapterScroll(i)}>
              {c}
            </button>
          ))}
        </div>
        <LiveBlock active={onScreen} />
      </div>
    </header>
  );
}
