"use client";

import Lenis from "lenis";
import { useEffect, useRef, useState, type RefObject } from "react";

/** True when the visitor asked their system for less motion. Read once on mount. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Whether the element is on screen (or near it). `once` keeps it true after the first sighting. */
export function useInView<T extends Element>(
  ref: RefObject<T | null>,
  { once = false, margin = "0px" }: { once?: boolean; margin?: string } = {},
): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once, margin]);
  return inView;
}

// The one Lenis instance, so chapter buttons can glide to a point in the page.
let lenis: Lenis | null = null;

/** Glide to a scroll position: Lenis when it runs, the browser otherwise. */
export function scrollToY(y: number) {
  if (lenis) lenis.scrollTo(y, { duration: 1.4 });
  else window.scrollTo({ top: y, behavior: "smooth" });
}

/** Hold the page still under a full-screen sheet (the phone menu), and let it go again. */
export function setScrollLock(locked: boolean) {
  if (lenis) {
    if (locked) lenis.stop();
    else lenis.start();
  }
  document.documentElement.style.overflow = locked ? "hidden" : "";
}

/** Where in the pinned dive each of its four steps sits, as a fraction of its scroll. */
export const CHAPTER_AT = [0.04, 0.42, 0.66, 0.95];

/** Glide to one step of the pinned dive (the chapter pills in the hero use it). */
export function chapterScroll(i: number) {
  const pin = document.getElementById("dive");
  if (!pin) return;
  const top = pin.getBoundingClientRect().top + window.scrollY;
  scrollToY(top + (pin.offsetHeight - window.innerHeight) * CHAPTER_AT[i]);
}

/**
 * Smooth, weighted scrolling for the landing only. The wallet keeps native
 * scrolling, where forms and lists matter more than feel. Skipped entirely for
 * reduced motion. Anything inside a dialog (Privy's sign-in) scrolls natively.
 */
export function useSmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const instance = new Lenis({
      autoRaf: true,
      lerp: 0.085,
      anchors: { offset: 0 },
      prevent: (node) => Boolean(node.closest?.('[role="dialog"], [id^="privy"], [data-lenis-prevent]')),
    });
    lenis = instance;
    return () => {
      instance.destroy();
      if (lenis === instance) lenis = null;
    };
  }, []);
}

/**
 * Reveal-on-scroll for everything under `root` marked data-td-reveal (fades
 * and rises) or td-words (headline words rise out of a mask). One observer for
 * the whole page instead of one per element.
 */
export function useRevealAll(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const targets = el.querySelectorAll("[data-td-reveal], .td-words");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [root]);
}

/** The depth, in metres below the surface, at the middle of the screen. */
export function useDepth(): number {
  const [depth, setDepth] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const mid = window.scrollY + window.innerHeight / 2;
      const marks = Array.from(document.querySelectorAll<HTMLElement>("[data-depth]")).map((n) => ({
        y: n.getBoundingClientRect().top + window.scrollY,
        d: Number(n.dataset.depth),
      }));
      if (!marks.length) return;
      let d = marks[0].d;
      for (let i = 0; i < marks.length - 1; i++) {
        const a = marks[i];
        const b = marks[i + 1];
        if (mid >= a.y && mid < b.y) {
          d = a.d + ((b.d - a.d) * (mid - a.y)) / (b.y - a.y);
          break;
        }
        if (mid >= b.y) d = b.d;
      }
      const rounded = Math.round(d);
      if (rounded !== last.current) {
        last.current = rounded;
        setDepth(rounded);
      }
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
  return depth;
}

/** "−23 m", with a real minus sign. */
export function formatDepth(d: number): string {
  return d === 0 ? "0 m" : `−${Math.abs(d)} m`;
}

/**
 * The account a handle would get on first sign-in, for the live preview under
 * the handle box. Mirrors handleLabel() in packages/chain-near/src/names.ts
 * (copied, not imported, so the landing does not pull in the NEAR SDK). It is
 * a preview: if the name is taken, the real account gets a suffix.
 */
export function previewAccount(handle: string, network: "testnet" | "mainnet"): string | null {
  const raw = handle.trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(raw)) return null; // not an X username
  const label = raw.toLowerCase().replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[a-z0-9]+([-_][a-z0-9]+)*$/.test(label)) return null;
  return `${label}.x.selkiepay.${network === "mainnet" ? "near" : "testnet"}`;
}
