"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { isNear } from "@/lib/chain";

type Question = { q: string; a: string };

/**
 * The NEAR answers. Two of them are fixed wording from the hackathon brief
 * (where the money is kept, and what Selkie can do with money that is waiting)
 * because they are the trust claims a reader can check on the explorer.
 */
const NEAR_QUESTIONS: Question[] = [
  {
    q: "Does the person I am paying need an account?",
    a: "No. That is the whole point. You send to their X handle and the money waits for that X account. When they sign in with X for the first time, it lands in their own NEAR account. If they never turn up, you take it back.",
  },
  {
    q: "What does it cost?",
    a: "Nothing. Opening your account is free, and nobody pays gas to send or receive. You approve each payment and Selkie pays the network fee, so a small amount stays a small amount. Moving money to another chain or a bank has a fee, and it is in the price you see first.",
  },
  {
    q: "How long does it take to arrive?",
    a: "Seconds. If the person you paid has already signed in once, it is in their balance before you have closed the tab.",
  },
  {
    q: "What if I send to the wrong handle?",
    a: "If they have not claimed it yet, it is still waiting, and you can take it back from your activity list once its waiting period ends. Once someone has claimed a payment it belongs to them, the same as cash.",
  },
  {
    q: "Is there anything to write down or keep safe?",
    a: "Nothing. No long code, no twelve words, no file to back up. You sign in with X and your money is there, on any device.",
  },
  {
    q: "Can I get the money out?",
    a: "Yes. Send it on to anyone with an X handle, cash out to any NEAR account (your own wallet or an exchange), or to another chain such as USDC on Base or USDT on Tron through NEAR Intents. Other chains send for real on mainnet; on testnet you see live prices as a preview.",
  },
  {
    q: "Can I cash out to my bank?",
    a: "On NEAR mainnet, yes: naira to any Nigerian bank, and shillings to a bank or mobile money in Kenya, Uganda and Tanzania. You see the account name and the live rate before anything moves. On testnet you can walk through it as a preview.",
  },
  {
    q: "Can I pay from a tweet?",
    a: "Yes. Post “@SelkiePay send 5 to @friend”. If you have filled an X pocket and they are on Selkie, it is paid on the spot. Otherwise the bot replies with a link you check and sign. The bot can only spend your pocket, up to your daily limit.",
  },
  {
    q: "Where is my money actually kept?",
    a: "In your own NEAR account, named after your X handle. Its only key is yours, created when you signed in. Selkie holds no key to it. Check it yourself on the explorer.",
  },
  {
    q: "What can Selkie do with money waiting for me?",
    a: "Only one thing: release it to the account of the person who signs in with that X account. It can't take it, change the amount, or stop the sender's refund.",
  },
  {
    q: "Is this real money?",
    a: "Not yet. Selkie on NEAR runs on testnet, so balances are test USDC with no real value.",
  },
];

const STELLAR_QUESTIONS: Question[] = [
  {
    q: "Does the person I am paying need an account?",
    a: "No. That is the whole point. You send to their handle and the money is held for them. When they sign in for the first time, with one tap, it is already there. If they never turn up, you take it back.",
  },
  {
    q: "What does it cost?",
    a: "Opening your account is free, and the person you pay never pays anything to receive. We cover the network cost of every payment, so a small amount stays a small amount.",
  },
  {
    q: "How long does it take to arrive?",
    a: "Seconds. If the person you paid has already signed in once, it is in their balance before you have closed the tab.",
  },
  {
    q: "What if I send to the wrong handle?",
    a: "If they have not claimed it yet, you can take it back from your activity list and the money returns to you in full. Once someone has claimed a payment it belongs to them, the same as cash.",
  },
  {
    q: "Is there anything to write down or keep safe?",
    a: "Nothing. No long code, no twelve words, no file to back up. You sign in the way you already sign in to everything else, and your money is there.",
  },
  {
    q: "Can I get the money out?",
    a: "Yes. You can send it on to anyone, move it to an account you already use, or cash out. You are never locked in.",
  },
  {
    q: "Where is my money actually kept?",
    a: "In an account that belongs to you and nobody else, with its own address you can look up at any time. We cannot spend it and we cannot freeze it.",
  },
];

const QUESTIONS = isNear ? NEAR_QUESTIONS : STELLAR_QUESTIONS;

/**
 * The questions people ask before they will put money into something.
 *
 * One open at a time. An accordion where every row can be open at once turns
 * into the wall of text the accordion was there to avoid. The answer is always
 * mounted and animates its row from 0fr to 1fr, so opening has somewhere to go.
 */
export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div>
      {QUESTIONS.map((item, index) => {
        const isOpen = open === index;
        return (
          <div key={item.q} className={`td-qa${isOpen ? " open" : ""}`}>
            <button className="q" onClick={() => setOpen(isOpen ? null : index)} aria-expanded={isOpen}>
              <span>{item.q}</span>
              <i aria-hidden="true">
                <Plus size={16} strokeWidth={2.4} />
              </i>
            </button>
            <div className="a">
              <div>
                <p>{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
