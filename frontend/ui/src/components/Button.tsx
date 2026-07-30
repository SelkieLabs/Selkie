import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/** The one button. Style lives in the design system, not in each screen. */
export function Button({ variant = "primary", className = "", ...rest }: ButtonProps) {
  return <button className={`slk-btn slk-btn--${variant} ${className}`.trim()} {...rest} />;
}
