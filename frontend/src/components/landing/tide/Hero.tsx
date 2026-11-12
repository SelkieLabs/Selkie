"use client";

import { AlertTriangle, ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAuth } from "@/contexts/useAuth";
import { NEAR_NETWORK } from "@/lib/chain";
import { Caustics } from "./Caustics";
import { HandleForm } from "./HandleForm";
import { chapterScroll, formatDepth, previewAccount, scrollToY, setScrollLock, useDepth, useInView } from "./hooks";
import { Kelp, Motes } from "./Sea";

const CHAPTERS = ["01 you send", "02 it waits", "03 they sign in", "04 it's theirs"];

const MENU = [
  { href: "#how", label: "How it works" },
  { href: "#proof", label: "Proof" },
  { href: "#chains", label: "Any chain" },
  { href: "#many", label: "Pay many" },
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

function Nav() {
  const { signIn } = useAuth();
  const depth = useDepth();
  const [menu, setMenu] = useState(false);
  const close = useRef(() => setMenu(false)).current;
  return (
    <nav className="td-nav" aria-label="Main">
      <div className="l">
        <span className="td-wm">Selkie</span>
        <span className="td-mono" aria-hidden="true">
          depth {formatDepth(depth)}
        </span>
      </div>
      <div className="links">
        <a href="#how">How it works</a>
        <a href="#proof">Proof</a>
        <a href="#faq">FAQ</a>
      </div>
      <div className="r">
        <button onClick={signIn} className="td-btn td-btn-ghost">
          Open Selkie
        </button>
        <button className="td-burger" onClick={() => setMenu(true)} aria-label="Open menu" aria-expanded={menu}>
          <Menu size={22} />
        </button>
      </div>
      <MenuSheet open={menu} onClose={close} />
    </nav>
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
            <div className="av">{shown.slice(0, 1).toUpperCase()}</div>
            <div className="name">@{shown}</div>
            <div className="acct">{account}</div>
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

export function Hero() {
  const { problem } = useAuth();
  const [handle, setHandle] = useState("");
  const ref = useRef<HTMLElement>(null);
  const onScreen = useInView(ref);

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
            <HandleForm onHandle={setHandle} />
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
