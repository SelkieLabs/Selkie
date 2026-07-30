import type { HTMLAttributes } from "react";

/** A surface panel. Consistent padding, radius, and border everywhere. */
export function Card({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`slk-card ${className}`.trim()} {...rest} />;
}
