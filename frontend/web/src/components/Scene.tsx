/**
 * The moonlit cove every page floats in. Pure SVG and CSS: no image assets,
 * so it ships in the bundle, scales to any screen, and stays crisp.
 *
 * Everything here is decoration: fixed, behind the app, inert to the pointer
 * and invisible to screen readers. Reduced-motion hides the moving pieces.
 */

const BUBBLES = [
  { left: "8%", size: 10, dur: 17, delay: 0 },
  { left: "16%", size: 6, dur: 22, delay: 6 },
  { left: "27%", size: 13, dur: 19, delay: 11 },
  { left: "43%", size: 7, dur: 25, delay: 3 },
  { left: "58%", size: 9, dur: 18, delay: 14 },
  { left: "71%", size: 6, dur: 23, delay: 8 },
  { left: "83%", size: 12, dur: 20, delay: 1 },
  { left: "92%", size: 8, dur: 24, delay: 17 },
];

/** One kelp cluster: a few blades sharing a root. */
function Kelp({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      width="170"
      height="240"
      viewBox="0 0 170 240"
      fill="none"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      <g stroke="#0e3130" strokeLinecap="round" fill="none">
        <path d="M30 240 C 18 200 44 170 30 128 C 18 92 40 66 32 34" strokeWidth="9" />
        <path d="M64 240 C 76 196 52 168 68 122 C 80 88 60 60 72 22" strokeWidth="11" />
        <path d="M102 240 C 92 206 116 178 104 140 C 94 108 114 84 106 56" strokeWidth="8" />
        <path d="M138 240 C 148 210 128 186 142 152 C 152 126 136 104 146 80" strokeWidth="7" />
      </g>
      <g stroke="#134039" strokeLinecap="round" fill="none" opacity="0.7">
        <path d="M48 240 C 40 210 58 190 48 158" strokeWidth="6" />
        <path d="M122 240 C 130 216 114 198 124 172" strokeWidth="5" />
      </g>
    </svg>
  );
}

/** A tiny fish, drawn once and echoed into a school. */
function Fish() {
  return (
    <path d="M0 6 C 6 0 16 0 22 6 C 16 12 6 12 0 6 Z M22 6 L 30 1 L 30 11 Z" fill="#cfe4ea" />
  );
}

export function Scene() {
  // Three depth bands so the landing's scroll driver can drift each at its
  // own rate (see "the descent" in index.css). The parallax transform lives
  // on the band, so the members' own animations keep running untouched.
  return (
    <div className="sea-layer" aria-hidden="true">
      {/* far water: the moonlight, first to recede as you sink */}
      <div className="layer-far">
        <span className="ray" style={{ left: "30%", width: "6rem", animationDelay: "0s" }} />
        <span className="ray" style={{ left: "46%", width: "9rem", animationDelay: "-4s", opacity: 0.8 }} />
        <span className="ray" style={{ left: "63%", width: "5rem", animationDelay: "-7s", opacity: 0.6 }} />
      </div>

      {/* mid water: the lives drifting through it */}
      <div className="layer-mid">
        {BUBBLES.map((b, i) => (
          <span
            key={i}
            className="bubble"
            style={{
              left: b.left,
              width: b.size,
              height: b.size,
              animationDuration: `${b.dur}s`,
              animationDelay: `${b.delay}s`,
            }}
          />
        ))}

        <svg
          className="school"
          style={{ top: "38%", width: 120, animationDuration: "75s", animationDelay: "-30s" }}
          viewBox="0 0 120 60"
        >
          <g transform="translate(0 4) scale(0.9)"><Fish /></g>
          <g transform="translate(34 18) scale(0.7)"><Fish /></g>
          <g transform="translate(66 6) scale(0.8)"><Fish /></g>
          <g transform="translate(88 26) scale(0.6)"><Fish /></g>
          <g transform="translate(20 40) scale(0.65)"><Fish /></g>
        </svg>

        {/* and, once in a long while, the selkie herself */}
        <svg
          className="seal"
          style={{ top: "22%", width: 150, animationDuration: "150s", animationDelay: "-45s" }}
          viewBox="0 0 150 60"
        >
          <path
            d="M8 34 C 2 28 6 20 16 22 L 26 25 C 44 12 78 8 104 18 C 120 24 132 22 142 14 C 146 22 140 32 128 35 C 134 40 142 40 148 38 C 144 48 130 50 118 44 C 96 54 60 54 38 44 C 28 48 16 46 10 40 Z"
            fill="#cfe4ea"
          />
          <circle cx="118" cy="22" r="1.6" fill="#04121c" />
        </svg>
      </div>

      {/* near water: the floor and kelp, rising to meet you */}
      <div className="layer-near">
        <svg className="floor" viewBox="0 0 1440 130" preserveAspectRatio="none" height="130">
          <path
            d="M0 130 L0 84 C 90 66 150 92 240 80 C 340 66 400 96 500 88 C 590 82 660 58 760 74 C 860 90 930 70 1030 82 C 1130 94 1200 64 1300 78 C 1370 88 1410 80 1440 86 L1440 130 Z"
            fill="#03121b"
          />
          <path
            d="M180 130 C 186 108 206 108 212 130 Z M640 130 C 648 100 672 100 680 130 Z M1080 130 C 1087 106 1105 106 1112 130 Z"
            fill="#0a2833"
          />
        </svg>

        <span className="kelp" style={{ left: "-2rem", animationDelay: "-2s" }}>
          <Kelp />
        </span>
        <span className="kelp hidden sm:block" style={{ left: "8rem", animationDelay: "-6s", opacity: 0.6 }}>
          <Kelp flip />
        </span>
        <span className="kelp" style={{ right: "-2.5rem", animationDelay: "-4s" }}>
          <Kelp flip />
        </span>
        <span className="kelp hidden md:block" style={{ right: "9rem", animationDelay: "0s", opacity: 0.55 }}>
          <Kelp />
        </span>
      </div>

      {/* the water darkening with depth */}
      <div className="depth-veil" />
    </div>
  );
}
