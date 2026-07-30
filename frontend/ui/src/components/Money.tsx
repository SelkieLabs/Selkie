import type { Money as MoneyValue } from "@selkie/core";

/** Renders an amount the same way on every surface, so money never looks off. */
export function Money({ value, className }: { value: MoneyValue; className?: string }) {
  const n = Number(value.amount);
  const formatted = Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value.amount;
  return (
    <span className={className}>
      {formatted} {value.asset}
    </span>
  );
}
