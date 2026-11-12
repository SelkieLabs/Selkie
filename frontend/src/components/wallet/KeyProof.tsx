"use client";

import { useEffect, useState } from "react";
import { ExternalLink, KeyRound, ShieldAlert } from "lucide-react";
import { api, type AccountKeys } from "@/lib/api";

/**
 * "Selkie holds no key", as something you can check rather than a promise.
 *
 * Reads the account's access keys from the chain (through the API, which only
 * forwards what the RPC says) and links to the explorer so anyone can see the
 * same list without trusting this screen. If Selkie ever did hold a key it says
 * so plainly: a proof badge that can only say yes is not a proof.
 *
 * Drawn as the foot of the balance card, so the claim sits next to the money
 * it protects.
 */
export function KeyProof() {
  // undefined while asking, null when the answer did not come.
  const [proof, setProof] = useState<AccountKeys | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api.near
      .keys()
      .then((keys) => live && setProof(keys))
      // Not knowing is not the same as a bad answer. Show nothing rather than guess.
      .catch(() => live && setProof(null));
    return () => {
      live = false;
    };
  }, []);

  if (proof === null) return null;

  const shell =
    "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-dashed border-pen/20 pt-3 text-[13.5px] text-pen/70";

  if (proof === undefined) {
    return (
      <div className={shell} aria-hidden="true">
        <span className="skel h-[26px] w-64 max-w-full rounded-lg" />
      </div>
    );
  }

  const count = proof.keys.length;
  const yours = proof.keys.filter((key) => key.heldBy === "you").length;
  const clean = !proof.selkieHoldsKey && count > 0 && yours === count;

  return (
    <div className={shell}>
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg ${
            clean ? "bg-sg/15 text-sg" : "bg-[#f28b9b]/15 text-[#f28b9b]"
          }`}
        >
          {clean ? <KeyRound size={14} strokeWidth={2.2} /> : <ShieldAlert size={14} strokeWidth={2.2} />}
        </span>
        <span className="min-w-0">
          Keys on this account:{" "}
          <b className="font-semibold text-pen">
            {count}
            {clean ? (count === 1 ? ", yours." : ", all yours.") : "."}
          </b>{" "}
          {proof.selkieHoldsKey ? "One of them is Selkie's." : "Selkie holds none."}
        </span>
      </span>
      <a
        href={proof.explorerUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[12.5px] text-sg transition-opacity duration-150 hover:opacity-80"
      >
        View on explorer <ExternalLink size={13} />
      </a>
    </div>
  );
}
