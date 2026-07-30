import { useEffect, useRef, type ReactNode } from "react";

/**
 * Scroll-triggered entrance: the wrapped block rises, fades and unblurs the
 * first time it comes into view. `delay` staggers siblings.
 */
export function Reveal({
  children,
  delay = 0,
  variant,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  /** Entrance direction: from the left, the right, or surfacing from below. */
  variant?: "left" | "right" | "pop";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-in");
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${variant ? `reveal-${variant}` : ""} ${className}`}
      style={{ "--reveal-delay": `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
