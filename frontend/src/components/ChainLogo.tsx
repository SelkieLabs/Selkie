"use client";

import { useState } from "react";
import { chainLogoUrl, coinLogoUrl } from "@/lib/logos";

/** A round logo that turns into its first letter if the image will not load. */
function Logo({ src, label, size, className = "" }: { src: string | null; label: string; size: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span
        className={`grid shrink-0 place-items-center rounded-full border-2 border-pen/15 bg-pen/[0.06] font-display font-bold text-pen/70 ${className}`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
        aria-hidden="true"
      >
        {label.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={label}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-full bg-white ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** A chain's own mark: Base, Tron, NEAR... */
export function ChainLogo({ blockchain, name, size = 20, className }: { blockchain: string; name: string; size?: number; className?: string }) {
  return <Logo src={chainLogoUrl(blockchain)} label={name} size={size} className={className} />;
}

/**
 * The coin with its chain in the corner, the way wallets show it: USDT with a
 * small Tron mark reads as "USDT on Tron" before anyone reads the words.
 */
export function CoinOnChain({
  symbol,
  blockchain,
  chainName,
  size = 28,
}: {
  symbol: string;
  blockchain: string;
  chainName: string;
  size?: number;
}) {
  const badge = Math.max(12, Math.round(size * 0.48));
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} aria-label={`${symbol} on ${chainName}`}>
      <Logo src={coinLogoUrl(symbol)} label={symbol} size={size} />
      <span className="absolute -bottom-0.5 -right-1 rounded-full ring-2 ring-card-bright">
        <ChainLogo blockchain={blockchain} name={chainName} size={badge} />
      </span>
    </span>
  );
}

/** A few chain marks overlapping, for "another chain" before one is picked. */
export function ChainStack({ chains, size = 22 }: { chains: Array<{ blockchain: string; name: string }>; size?: number }) {
  return (
    <span className="flex items-center">
      {chains.map((chain, i) => (
        <span
          key={chain.blockchain}
          className={`relative rounded-full ring-2 ring-card-bright ${i ? "-ml-1.5" : ""}`}
          style={{ zIndex: chains.length - i }}
        >
          <ChainLogo blockchain={chain.blockchain} name={chain.name} size={size} />
        </span>
      ))}
    </span>
  );
}
