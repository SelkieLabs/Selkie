import type { CSSProperties } from "react";

/**
 * The furniture of the water: kelp that sways from its root, motes drifting
 * up through the light, and the escrow chest where waiting money sits.
 * All deterministic (no Math.random), so server and client draw the same sea.
 */

type Strand = [x: number, height: number, width: number, phase: number, amplitude: number];

function strandShapes(strands: Strand[], H: number, fill: string, blade: string) {
  return strands.map(([x0, h, w, ph, amp], key) => {
    const N = 24;
    const L: [number, number][] = [];
    const R: [number, number][] = [];
    const blades: string[] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const y = H - u * h;
      const x = x0 + Math.sin(u * 3.2 + ph) * amp * u;
      const ww = (w * (1 - u * 0.78)) / 2;
      L.push([x - ww, y]);
      R.push([x + ww, y]);
      if (i > 3 && i < N - 1 && i % 4 === 0) {
        const side = (i / 4) % 2 ? 1 : -1;
        const bl = 22 + w * 2.2;
        blades.push(
          `M${x.toFixed(1)},${y.toFixed(1)} q${(side * bl * 0.55).toFixed(1)},${(-bl * 0.2).toFixed(1)} ${(side * bl).toFixed(1)},${(-bl * 0.7).toFixed(1)} q${(-side * bl * 0.35).toFixed(1)},${(bl * 0.15).toFixed(1)} ${(-side * bl).toFixed(1)},${(bl * 0.7).toFixed(1)}z`,
        );
      }
    }
    const pts = L.concat(R.reverse())
      .map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)
      .join(" ");
    return (
      <g key={key}>
        <polygon points={pts} fill={fill} stroke="rgba(127,209,185,.10)" strokeWidth="1" />
        {blades.map((d, i) => (
          <path key={i} d={d} fill={blade} opacity=".95" />
        ))}
      </g>
    );
  });
}

export function Kelp({
  strands,
  width,
  height,
  style,
  fill = "#031018",
  blade = "#04121a",
}: {
  strands: Strand[];
  width: number;
  height: number;
  style?: CSSProperties;
  fill?: string;
  blade?: string;
}) {
  return (
    <svg
      className="td-kelp"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={style}
      aria-hidden="true"
    >
      {strandShapes(strands, height, fill, blade)}
    </svg>
  );
}

/** A seeded generator, so the motes land in the same places on every render. */
function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function Motes({ count, seed = 7, top = 0 }: { count: number; seed?: number; top?: number }) {
  const rnd = seeded(seed);
  const motes = Array.from({ length: count }, () => {
    const r = 1 + rnd() * 2.6;
    return {
      left: `${(rnd() * 100).toFixed(2)}%`,
      top: `${(top + rnd() * (100 - top)).toFixed(2)}%`,
      size: `${r.toFixed(2)}px`,
      opacity: (0.08 + rnd() * 0.3).toFixed(2),
      dur: `${(10 + rnd() * 14).toFixed(1)}s`,
      del: `${(-rnd() * 20).toFixed(1)}s`,
    };
  });
  return (
    <div className="td-motes" aria-hidden="true">
      {motes.map((m, i) => (
        <span
          key={i}
          style={
            {
              left: m.left,
              top: m.top,
              width: m.size,
              height: m.size,
              opacity: m.opacity,
              "--dur": m.dur,
              "--del": m.del,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function Chest({ open = false, glow = false, style }: { open?: boolean; glow?: boolean; style?: CSSProperties }) {
  return (
    <div className={`td-chest${open ? " open" : ""}${glow ? " glow" : ""}`} style={style} aria-hidden="true">
      <div className="lid">
        <span className="glint" />
      </div>
      <div className="body">
        <span className="band" style={{ left: 26 }} />
        <span className="band" style={{ right: 26 }} />
      </div>
      <span className="lock" />
    </div>
  );
}
