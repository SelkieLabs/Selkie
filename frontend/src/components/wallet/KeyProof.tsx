"use client";

import { useEffect, useState } from "react";
import { ExternalLink, ShieldAlert, ShieldCheck } from "lucide-react";
import { api, type AccountKeys } from "@/lib/api";

/**
 * "Selkie holds no key", as something you can check rather than a promise.
 *
 * Reads the account's access keys from the chain (through the API, which only
 * forwards what the RPC says) and links to the explorer so anyone can see the
 * same list without trusting this screen. If Selkie ever did hold a key it says
 * so plainly: a proof badge that can only say yes is not a proof.
 */
export function KeyProof() {
  const [proof, setProof] = useState<AccountKeys | null>(null);

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

  if (!proof) return null;

  const count = proof.keys.length;
  const yours = proof.keys.filter((key) => key.heldBy === "you").length;
  const clean = !proof.selkieHoldsKey && count > 0 && yours === count;

  return (
    <a
      href={proof.explorerUrl}
      target="_blank"
      rel="noreferrer"
      className="mt-5 flex items-center gap-2.5 rounded-xl border-2 border-pen/15 bg-card-bright/60 px-3.5 py-2.5 text-[13px] leading-snug text-pen/80 transition-colors hover:bg-card-bright"
    >
      {clean ? (
        <ShieldCheck size={17} strokeWidth={2.4} className="shrink-0 text-[#2f7d3f]" />
      ) : (
        <ShieldAlert size={17} strokeWidth={2.4} className="shrink-0 text-[#a11d34]" />
      )}
      <span className="min-w-0 flex-1">
        <b className="font-bold text-pen">
          Keys on this account: {count}
          {clean ? (count === 1 ? " — yours." : " — all yours.") : "."}
        </b>{" "}
        {proof.selkieHoldsKey ? "One of them is Selkie's." : "Selkie holds none."}
      </span>
      <span className="flex shrink-0 items-center gap-1 font-bold text-pen/55">
        Check <ExternalLink size={12} />
      </span>
    </a>
  );
}
