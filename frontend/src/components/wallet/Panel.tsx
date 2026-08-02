import type { ReactNode } from "react";

/**
 * The shape every wallet tab takes: one ivory chunk, one heading, one job.
 *
 * Five screens that each invented their own header is five screens that feel
 * like five products. This is the only reason it exists.
 */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`chunk p-6 sm:p-7 ${className}`}>{children}</section>;
}

export function PanelHead({
  eyebrow,
  title,
  blurb,
  aside,
}: {
  eyebrow: string;
  title: string;
  blurb?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight">{title}</h1>
        {blurb && <p className="mt-2 text-[15px] leading-relaxed text-pen/65">{blurb}</p>}
      </div>
      {aside}
    </div>
  );
}
