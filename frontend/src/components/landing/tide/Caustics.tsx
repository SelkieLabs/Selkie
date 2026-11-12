"use client";

import { useEffect, useRef } from "react";

/**
 * Caustic light: the bright, wobbling net that sunlight throws through waves.
 *
 * A WebGL fragment shader (after Dave Hoskins' tileable water caustic), so it
 * costs the CPU nothing. It renders at reduced resolution (the CSS blur hides
 * that), stops when off screen or when the tab is hidden, and draws one still
 * frame for reduced motion. With `follow`, the light bends away from the
 * pointer, as if a hand were in the water. No WebGL means no canvas: the
 * gradient behind it carries on alone.
 */
export function Caustics({
  tile = 300,
  rgb = [150, 225, 205],
  top = 0.95,
  bottom = 0.04,
  falloff = 1.5,
  reverse = false,
  speed = 0.32,
  seed = 20,
  scale = 0.6,
  follow = false,
  className = "",
}: {
  /** Size of one repeat of the pattern, in CSS pixels. */
  tile?: number;
  rgb?: [number, number, number];
  /** Brightness at the top and bottom edges; `falloff` shapes the curve between. */
  top?: number;
  bottom?: number;
  falloff?: number;
  /** Brightest at the bottom instead (light coming back as you surface). */
  reverse?: boolean;
  speed?: number;
  seed?: number;
  /** Render resolution as a fraction of the CSS size times the (capped) pixel ratio. */
  scale?: number;
  follow?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) {
      canvas.style.display = "none";
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const vs = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
    const fs = `
      precision highp float;
      uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform float uTile;
      uniform vec3 uRgb; uniform float uA0; uniform float uA1; uniform float uFp; uniform float uRev;
      uniform float uPx; uniform float uBend;
      #define TAU 6.28318530718
      float caustic(vec2 uv, float t) {
        vec2 p = mod(uv * TAU, TAU) - 250.0;
        vec2 i = p; float c = 1.0; float inten = 0.005;
        for (int n = 0; n < 5; n++) {
          float tt = t * (1.0 - (3.5 / float(n + 1)));
          i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
          c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
        }
        c /= 5.0;
        c = 1.17 - pow(c, 1.4);
        return clamp(pow(abs(c), 7.0), 0.0, 1.0);
      }
      void main() {
        vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
        vec2 d = px - uMouse;
        float r = length(d);
        float s = uRes.y * 0.22;
        float bend = exp(-(r * r) / (2.0 * s * s)) * uBend;
        vec2 q = px + (d / max(r, 1.0)) * bend * 34.0 * uPx;
        float c = caustic(q / (uTile * uPx), uTime);
        float u = uRev > 0.5 ? px.y / uRes.y : 1.0 - px.y / uRes.y;
        float f = uA1 + (uA0 - uA1) * pow(u, uFp);
        float a = clamp(c * f, 0.0, 1.0);
        gl_FragColor = vec4(uRgb * a, a);
      }`;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      canvas.style.display = "none";
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = u("uRes");
    const uTime = u("uTime");
    const uMouse = u("uMouse");
    const uPx = u("uPx");
    const uBend = u("uBend");
    gl.uniform1f(u("uTile"), tile);
    gl.uniform3f(u("uRgb"), rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    gl.uniform1f(u("uA0"), top);
    gl.uniform1f(u("uA1"), bottom);
    gl.uniform1f(u("uFp"), falloff);
    gl.uniform1f(u("uRev"), reverse ? 1 : 0);

    let px = 1;
    const size = () => {
      px = Math.min(window.devicePixelRatio || 1, 1.5) * scale;
      const w = Math.max(1, Math.round(canvas.clientWidth * px));
      const h = Math.max(1, Math.round(canvas.clientHeight * px));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uPx, px);
    };
    size();

    // pointer, eased so the light flows round the hand rather than snapping
    const target = { x: -9999, y: -9999, on: 0 };
    const mouse = { x: -9999, y: -9999, bend: 0 };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      target.x = (e.clientX - r.left) * px;
      target.y = (e.clientY - r.top) * px;
      target.on = e.clientY >= r.top && e.clientY <= r.bottom ? 1 : 0;
      if (mouse.x < -999) {
        mouse.x = target.x;
        mouse.y = target.y;
      }
    };

    let raf = 0;
    let visible = false;
    let last = performance.now();
    let t = seed;
    const draw = () => {
      gl.uniform1f(uTime, t);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uBend, mouse.bend);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt * speed;
      mouse.x += (target.x - mouse.x) * 0.06;
      mouse.y += (target.y - mouse.y) * 0.06;
      mouse.bend += ((follow ? target.on : 0) - mouse.bend) * 0.04;
      draw();
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (reduced || raf || !visible || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    draw();
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) start();
    });
    io.observe(canvas);
    const ro = new ResizeObserver(() => {
      size();
      if (reduced || !raf) draw();
    });
    ro.observe(canvas);
    const onVis = () => start();
    document.addEventListener("visibilitychange", onVis);
    if (follow && !reduced) window.addEventListener("pointermove", onMove, { passive: true });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
    // The look is fixed per instance; props never change after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={ref} className={`td-caustics ${className}`} aria-hidden="true" />;
}
