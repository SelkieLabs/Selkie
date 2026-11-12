import type { ReactNode } from "react";
import { Check } from "lucide-react";

/**
 * The shape every wallet tab takes: one ink panel, one heading, one job.
 *
 * Five screens that each invented their own header is five screens that feel
 * like five products. This is the only reason it exists.
 */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`chunk p-5 sm:p-7 ${className}`}>{children}</section>;
}

/**
 * Where you are in a flow, and how far it goes. Numbered rather than a bar,
 * because "2 of 3, Check" says what comes next and a bar only says how much.
 */
export function Steps({ labels, at }: { labels: string[]; at: number }) {
  return (
    <ol className="steps" aria-label={`Step ${at + 1} of ${labels.length}: ${labels[at] ?? ""}`}>
      {labels.map((label, i) => (
        <li key={label} className={i === at ? "on" : i < at ? "done" : undefined}>
          <span className="n">{i < at ? <Check size={11} strokeWidth={2.6} /> : i + 1}</span>
          <span className={i === at ? undefined : "hidden sm:inline"}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export function PanelHead({
  eyebrow,
  title,
  blurb,
  aside,
  steps,
}: {
  eyebrow: string;
  title: string;
  blurb?: ReactNode;
  aside?: ReactNode;
  /** The flow this screen is part of, and which step it is. */
  steps?: { labels: string[]; at: number };
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="eyebrow">{eyebrow}</p>
          {steps && <Steps labels={steps.labels} at={steps.at} />}
        </div>
        <h1 className="mt-1.5 font-display text-[1.6rem] font-extrabold leading-tight tracking-[-0.03em]">
          {title}
        </h1>
        {blurb && <p className="mt-2 text-[15px] leading-relaxed text-pen/60">{blurb}</p>}
      </div>
      {aside}
    </div>
  );
}
