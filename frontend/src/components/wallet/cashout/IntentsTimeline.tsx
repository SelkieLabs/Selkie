"use client";

import { ExternalLink } from "lucide-react";
import { intentsStages, useIntentsStatus } from "@/lib/other-chain";
import { Timeline } from "./bits";

/**
 * A move between chains, followed live: NEAR Intents' status every few
 * seconds, drawn as the steps a person would describe, with the transactions
 * on each side once they exist.
 */
export function IntentsTimeline({
  depositAddress,
  direction,
  asset,
}: {
  depositAddress: string;
  direction: "in" | "out";
  asset: { symbol: string; chainName: string };
}) {
  const { status, problem } = useIntentsStatus(depositAddress);
  const origin = status?.originTxs ?? [];
  const links = [
    ...origin.map((url) => ({ url, label: direction === "out" ? "Transfer to NEAR Intents" : "Your deposit" })),
    ...(status?.destinationTxs ?? []).map((url) => ({ url, label: direction === "out" ? `Arrival on ${asset.chainName}` : "Arrival on NEAR" })),
  ];

  return (
    <div aria-live="polite">
      <Timeline stages={intentsStages(status, direction, asset)} />
      {problem && <p className="co-hint mt-3">Could not check just now. Trying again.</p>}
      {links.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          {links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="co-link">
              {link.label} <ExternalLink size={12} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
