"use client";

import { useEffect, useRef } from "react";

/**
 * Caustic light: the bright net sunlight draws on things under water.
 *
 * Drawn on the CPU into one small tile that repeats, rather than a shader:
 * a 64px tile is a few thousand pixels a frame, it needs no WebGL context
 * (phones cap those, and the landing already uses one), and the tile scaled
 * up with smoothing is exactly the soft look wanted. The pattern is after
 * Dave Hoskins' tileable water caustic, which is periodic by construction, so
 * the tile repeats with no seam.
 *
 * It only animates while it is on screen and the tab is visible, and draws a
 * single still frame for anyone who asked for reduced motion.
 */

const N = 64;
const TAU = Math.PI * 2;

function caustic(x: number, y: number, t: number): number {
  const px = (((x * TAU) % TAU) + TAU) % TAU - 250;
  const py = (((y * TAU) % TAU) + TAU) % TAU - 250;
  let ix = px;
  let iy = py;
  let c = 1;
  const inten = 0.005;
  for (let n = 0; n < 5; n++) {
    const tt = t * (1 - 3.5 / (n + 1));
    const nx = px + Math.cos(tt - ix) + Math.sin(tt + iy);
    const ny = py + Math.sin(tt - iy) + Math.cos(tt + ix);
    ix = nx;
    iy = ny;
    c += 1 / Math.hypot(px / (Math.sin(ix + tt) / inten), py / (Math.cos(iy + tt) / inten));
  }
  c /= 5;
  c = 1.17 - Math.pow(c, 1.4);
  return Math.min(1, Math.pow(Math.abs(c), 7));
}

export function Caustics({
  className,
  tile = 120,
  rgb = [127, 209, 185],
  top = 0.95,
  bottom = 0.2,
  speed = 0.32,
  still = false,
}: {
  className?: string;
  /** On-screen size of one repeat, in CSS pixels. */
  tile?: number;
  rgb?: [number, number, number];
  /** Strength at the top and at the bottom: light fades with depth. */
  top?: number;
  bottom?: number;
  /** Time units per second. Slow reads as water; fast reads as a screensaver. */
  speed?: number;
  /** One frame and no animation, whatever the motion setting. */
  still?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Unpacked so the effect depends on the numbers, not on a fresh array each render.
  const [r, g, b] = rgb;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const tileCanvas = document.createElement("canvas");
    tileCanvas.width = N;
    tileCanvas.height = N;
    const tctx = tileCanvas.getContext("2d");
    if (!tctx) return;
    const image = tctx.createImageData(N, N);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate = !still && !reduce;
    let t = 44.1;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const draw = () => {
      if (!width || !height) return;
      const data = image.data;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = (y * N + x) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = 255 * caustic(x / N, y / N, t);
        }
      }
      tctx.putImageData(image, 0, 0);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const pattern = ctx.createPattern(tileCanvas, "repeat");
      if (!pattern) return;
      const scale = (tile * dpr) / N;
      // A slow sideways drift on top of the pattern's own motion, like a current.
      const drift = (t * 6 * dpr) % (tile * dpr);
      pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, drift, drift * 0.35]));
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Fade with depth.
      ctx.globalCompositeOperation = "destination-in";
      const fade = ctx.createLinearGradient(0, 0, 0, canvas.height);
      fade.addColorStop(0, `rgba(0,0,0,${top})`);
      fade.addColorStop(1, `rgba(0,0,0,${bottom})`);
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
    };

    const size = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      draw();
    };

    const resize = new ResizeObserver(size);
    resize.observe(canvas);
    size();

    if (!animate) return () => resize.disconnect();

    let frame = 0;
    let last = 0;
    let onScreen = true;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      // About 24 frames a second: water this slow gains nothing from 120.
      if (now - last < 40) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      t += dt * speed;
      draw();
    };
    const start = () => {
      if (frame || !onScreen || document.hidden) return;
      last = 0;
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const seen = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? false;
      if (onScreen) start();
      else stop();
    });
    seen.observe(canvas);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      resize.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [tile, r, g, b, top, bottom, speed, still]);

  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
