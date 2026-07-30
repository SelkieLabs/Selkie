import { Link } from "react-router-dom";

/** The echo-send mark: three arrows, each a fainter echo of the last. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="selkie-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F6DFA4" />
          <stop offset="1" stopColor="#C9964B" />
        </linearGradient>
      </defs>
      <g strokeLinejoin="round" strokeWidth="7">
        <path d="M 9 17 L 9 47 L 35 32 Z" fill="#F2EBDC" stroke="#F2EBDC" opacity="0.18" />
        <path d="M 19 17 L 19 47 L 45 32 Z" fill="#F2EBDC" stroke="#F2EBDC" opacity="0.42" />
        <path d="M 29 17 L 29 47 L 55 32 Z" fill="url(#selkie-mark)" stroke="url(#selkie-mark)" />
      </g>
    </svg>
  );
}

export function Wordmark({ to = "/", tone = "ivory" }: { to?: string; tone?: "ivory" | "pen" }) {
  return (
    <Link
      to={to}
      // Unbacked on the scene, so it carries its own shadow to stay legible
      // over moonlit water.
      className="flex items-center gap-2.5 transition-opacity hover:opacity-80 [filter:drop-shadow(0_2px_10px_rgba(2,7,13,0.75))]"
      aria-label="Selkie home"
    >
      <Mark size={24} />
      <span
        className={`font-display text-[1.05rem] font-bold tracking-tight ${
          tone === "pen" ? "text-pen" : "text-ivory"
        }`}
      >
        Selkie
      </span>
    </Link>
  );
}

/** The mark as a loader: each echo arrow pulses in sequence. */
export function LoaderMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="loader-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F6DFA4" />
          <stop offset="1" stopColor="#C9964B" />
        </linearGradient>
      </defs>
      <g strokeLinejoin="round" strokeWidth="7">
        <path className="la" d="M 9 17 L 9 47 L 35 32 Z" fill="#F2EBDC" stroke="#F2EBDC" />
        <path
          className="la"
          style={{ animationDelay: "160ms" }}
          d="M 19 17 L 19 47 L 45 32 Z"
          fill="#F2EBDC"
          stroke="#F2EBDC"
        />
        <path
          className="la"
          style={{ animationDelay: "320ms" }}
          d="M 29 17 L 29 47 L 55 32 Z"
          fill="url(#loader-mark)"
          stroke="url(#loader-mark)"
        />
      </g>
    </svg>
  );
}

/** The X logo, for "Continue with X". */
export function XLogo({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
    </svg>
  );
}
