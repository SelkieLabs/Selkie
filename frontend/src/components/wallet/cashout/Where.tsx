"use client";

import type { ReactNode } from "react";
import { ArrowRight, Building2, Clock, Coins, Info, Wallet } from "lucide-react";
import { ChainLogo, ChainStack } from "@/components/ChainLogo";
import { NEAR_NETWORK, isNear } from "@/lib/chain";
import { usd } from "@/lib/format";
import { Head, Note } from "./bits";
import { CHAIN_PREVIEW, type Destination } from "./model";

interface Choice {
  to: Destination;
  icon: ReactNode;
  title: string;
  what: string;
  time: string;
  fee?: string;
  soon?: boolean;
}

/**
 * The ways out, each with what happens and what it costs, so the choice is
 * made on facts. On Stellar the bank says plainly that it is not open yet
 * instead of failing at the end.
 */
function choices(): Choice[] {
  if (isNear) return nearChoices();
  const bank: Choice = {
    to: "bank",
    icon: <Building2 size={21} strokeWidth={2.1} />,
    title: "Your bank account",
    what: "Paid into your bank in your own currency, ready to spend.",
    time: "Opening soon",
    soon: true,
  };
  return [
    bank,
    {
      to: "wallet",
      icon: <Wallet size={21} strokeWidth={2.1} />,
      title: "Another wallet",
      what: "Any wallet you already have. Straight there, nothing in between.",
      time: "Seconds",
    },
  ];
}

/**
 * On NEAR all three move money. The bank goes through Paycrest: NEAR Intents
 * swaps the USDC to Base on the way, so like the chain route it is a live
 * price on mainnet and a labelled preview on testnet.
 */
function nearChoices(): Choice[] {
  const mainnet = NEAR_NETWORK === "mainnet";
  return [
    {
      to: "wallet",
      icon: <ChainLogo blockchain="near" name="NEAR" size={26} />,
      title: "A NEAR account or exchange",
      what: "Your own NEAR wallet, or an exchange's NEAR deposit account.",
      time: "Seconds",
      fee: "No fee",
    },
    {
      to: "chain",
      icon: <ChainStack chains={CHAIN_PREVIEW} size={17} />,
      title: "Another chain",
      what: "USDC on Base, USDT on Tron and more. NEAR Intents swaps it on the way.",
      time: mainnet ? "A few minutes" : "Price preview on testnet",
      fee: mainnet ? "Fee in the price" : undefined,
    },
    {
      to: "bank",
      icon: <Building2 size={21} strokeWidth={2.1} />,
      title: "A bank account",
      what: "Naira to any Nigerian bank. Kenya, Uganda and Tanzania too, mobile money included.",
      time: mainnet ? "A few minutes" : "Rate preview on testnet",
      fee: mainnet ? "Fee in the rate" : undefined,
    },
  ];
}

export function WhereStep({
  picked,
  balance,
  onPick,
}: {
  picked: Destination | null;
  balance: string;
  onPick: (to: Destination) => void;
}) {
  return (
    <>
      <Head title="Where should it go?" blurb="Pick a way out. Nothing leaves until you have seen the numbers." />

      <div className="co-choices mt-6">
        {choices().map((choice) => (
          <button
            key={choice.to}
            type="button"
            className="co-choice"
            aria-pressed={picked === choice.to}
            onClick={() => onPick(choice.to)}
          >
            <span className="co-choice-icon" aria-hidden="true">
              {choice.icon}
            </span>
            <span className="min-w-0">
              <span className="co-choice-title">{choice.title}</span>
              <span className="co-choice-what">{choice.what}</span>
              <span className="co-choice-meta">
                <span className={choice.soon ? "co-soon" : undefined}>
                  <Clock size={12} /> {choice.time}
                </span>
                {choice.fee && (
                  <span>
                    <Coins size={12} /> {choice.fee}
                  </span>
                )}
              </span>
            </span>
            <ArrowRight size={18} strokeWidth={2.2} className="co-choice-arrow" aria-hidden="true" />
          </button>
        ))}
      </div>

      <div className="mt-5">
        <Note icon={<Info size={15} />}>
          You have <b>{usd(balance)}</b> to take out. Money you sent that is still waiting for someone is not
          counted, because it is not yours to spend until it comes back.
        </Note>
      </div>
    </>
  );
}
