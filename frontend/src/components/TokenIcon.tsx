import { ASSET_LABEL } from "@/lib/format";

/** The real mark for each asset. Served from /public so nothing is hotlinked. */
const ICONS: Record<string, string> = {
  USDC: "/tokens/usdc.svg",
  XLM: "/tokens/xlm.svg",
};

/**
 * An asset's own logo.
 *
 * People recognise money by its mark long before they read the code next to it,
 * and a lettered circle standing in for a real logo is the fastest way to look
 * like a weekend project. An asset we have no mark for falls back to its initial
 * rather than a broken image.
 */
export function TokenIcon({ asset, size = 28 }: { asset: string; size?: number }) {
  const code = asset.toUpperCase();
  const src = ICONS[code];
  const label = ASSET_LABEL[code] ?? code;

  if (!src) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-full border-2 border-pen/15 bg-pen/[0.06] font-display font-bold text-pen/70"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
        aria-hidden="true"
      >
        {code.slice(0, 1)}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={label}
      width={size}
      height={size}
      className="shrink-0 rounded-full"
      style={{ width: size, height: size }}
    />
  );
}
