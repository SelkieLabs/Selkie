"use client";

import { useRef, type CSSProperties } from "react";
import { Faq } from "@/components/landing/Faq";
import { DiveStory } from "./DiveStory";
import { Hero } from "./Hero";
import { formatDepth, useDepth, useRevealAll, useSmoothScroll } from "./hooks";
import { End, Gas, Intents, PayMany, Proof, Trust } from "./Sections";
import "./tide.css";

const MAX_DEPTH = 40;
const GAUGE_PX = 300;

/** The depth gauge on the right edge: a dot that sinks to −40 m and rises again as you read. */
function DepthGauge() {
  const depth = useDepth();
  const y = (Math.min(MAX_DEPTH, Math.abs(depth)) / MAX_DEPTH) * GAUGE_PX;
  return (
    <div className="td-gauge on" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} style={{ top: (i * GAUGE_PX) / 8, width: i % 4 === 0 ? 14 : 7 }} />
      ))}
      <span className="here" style={{ transform: `translateY(${y}px)`, transition: "transform 500ms var(--ease)" }} />
      <span className="read" style={{ transform: `translateY(${y}px)`, transition: "transform 500ms var(--ease)" }}>
        {formatDepth(depth)}
      </span>
    </div>
  );
}

/**
 * The NEAR landing page, "Tide": one dive from the surface to the floor and
 * back. Smooth scrolling, reveal-on-scroll and the depth readout are wired
 * here once for the whole page; each section owns its own motion.
 */
export function TideLanding() {
  const root = useRef<HTMLDivElement>(null);
  useSmoothScroll();
  useRevealAll(root);

  return (
    <div className="td" ref={root}>
      <Hero />
      <main>
        <DiveStory />
        <Proof />
        <Gas />
        <Intents />
        <PayMany />
        <Trust />
        <section id="faq" className="td-sec td-faq" data-depth="-20" aria-labelledby="faq-title">
          <div className="td-inner">
            <div>
              <div className="td-depth">−20 m · rising</div>
              <h2 id="faq-title" className="td-h2 td-words">
                <span className="td-word">
                  <span>Questions.</span>
                </span>
              </h2>
              <p className="td-lede" data-td-reveal>
                More detail, the contracts and the trust model are in the{" "}
                <a href="/docs" style={{ color: "var(--sg)", borderBottom: "1px solid currentColor" }}>
                  docs
                </a>
                .
              </p>
            </div>
            <div data-td-reveal style={{ "--d": "80ms" } as CSSProperties}>
              <Faq />
            </div>
          </div>
        </section>
      </main>
      <End />
      <DepthGauge />
    </div>
  );
}
