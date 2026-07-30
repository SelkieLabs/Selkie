"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  AtSign,
  BookOpen,
  Boxes,
  Coins,
  Compass,
  EyeOff,
  Fingerprint,
  Globe,
  HandCoins,
  Layers,
  Map as MapIcon,
  MessageCircle,
  Repeat,
  Rocket,
  Send,
  Sparkles,
  Store,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { Footer, Header, Shell } from "@/components/Layout";
import { TokenIcon } from "@/components/TokenIcon";

/* Each section is an anchor the sidebar tracks. Labels stay short so every
   nav row is the same height and the sliding indicator lands cleanly. */
const SECTIONS = [
  { id: "overview", label: "Overview", icon: BookOpen },
  { id: "quickstart", label: "Quick start", icon: Zap },
  { id: "pay-on-x", label: "Pay on X", icon: MessageCircle },
  { id: "sending", label: "Sending", icon: Send },
  { id: "requests", label: "Requests", icon: HandCoins },
  { id: "receiving", label: "Receiving", icon: AtSign },
  { id: "assets", label: "Assets", icon: Coins },
  { id: "privacy", label: "Privacy", icon: EyeOff },
  { id: "telegram", label: "Telegram", icon: Sparkles },
  { id: "why-canton", label: "Why Canton", icon: Compass },
  { id: "architecture", label: "How it works", icon: Layers },
  { id: "roadmap", label: "Roadmap", icon: MapIcon },
  { id: "vision", label: "Bigger picture", icon: Rocket },
] as const;

const ROW = 2.6; // rem per nav row; the sliding pill uses this to land on-row.

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md border-2 border-pen/12 bg-[#f2e6cc] px-1.5 py-0.5 font-mono text-[0.85em] font-semibold text-gold-ink">
      {children}
    </code>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="chunk scroll-mt-28 p-6 sm:p-8">
      <h2 className="font-display text-[1.6rem] font-bold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-pen/75">{children}</div>
    </section>
  );
}

/** A labelled key/value row, for command references and the like. */
function Ref({ cmd, desc }: { cmd: ReactNode; desc: string }) {
  return (
    <div className="flex flex-col gap-1 border-b-2 border-pen/10 py-2.5 last:border-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="sm:w-64 sm:shrink-0">{cmd}</div>
      <p className="text-sm text-pen/65">{desc}</p>
    </div>
  );
}

export default function Docs() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const activeIndex = Math.max(0, SECTIONS.findIndex((s) => s.id === active));
  const clicked = useRef<string | null>(null);

  // Scroll-spy: the section whose top most recently crossed the reading line
  // (just below the sticky header) is the active one. A click pins the target
  // until the smooth scroll settles so the pill does not skip through rows.
  useEffect(() => {
    const onScroll = () => {
      if (clicked.current) return;
      const line = 140;
      let current: string = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line) current = s.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function jump(id: string) {
    clicked.current = id;
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => (clicked.current = null), 700);
  }

  return (
    <>
      <Header />
      <main className="pb-8 pt-6 sm:pt-10">
        <Shell wide>
          {/* Masthead */}
          <div className="mb-8 flex flex-col gap-4 sm:mb-12 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <span className="eyebrow flex items-center gap-2 text-gold">
                <BookOpen size={13} /> Documentation
              </span>
              <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ivory sm:text-5xl">
                How Selkie works
              </h1>
              <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-ivory/60">
                Any X or Telegram handle is a private wallet on the Canton Network. No app, no seed
                phrase, no gas. Here is everything the wallet can do, and how it works underneath.
              </p>
            </div>
            <Link href="/dashboard/activity" className="btn btn-gold btn-sm shrink-0">
              Open your wallet <ArrowUpRight size={15} />
            </Link>
          </div>

          <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
            {/* Animated sidebar: a gold pill slides to the section you are reading. */}
            <aside className="hidden lg:block">
              <div className="sticky top-24">
                <p className="mb-3 pl-3 text-[11px] font-bold uppercase tracking-[0.16em] text-ivory/40">
                  On this page
                </p>
                <nav className="relative">
                  <span
                    aria-hidden
                    className="absolute left-0 right-0 rounded-xl bg-gradient-to-b from-gold-light to-gold-deep shadow-[0_8px_20px_-8px_rgba(217,168,92,0.6)] transition-transform duration-300 ease-out"
                    style={{ height: `${ROW}rem`, transform: `translateY(${activeIndex * ROW}rem)` }}
                  />
                  <div className="relative flex flex-col">
                    {SECTIONS.map((s) => {
                      const on = active === s.id;
                      return (
                        <button
                          key={s.id}
                          onClick={() => jump(s.id)}
                          style={{ height: `${ROW}rem` }}
                          className={`relative z-10 flex items-center gap-2.5 rounded-xl px-3 text-left text-sm font-bold transition-colors duration-200 ${
                            on ? "text-pen" : "text-ivory/55 hover:text-ivory"
                          }`}
                          aria-current={on ? "true" : undefined}
                        >
                          <s.icon size={15} className="shrink-0" />
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </nav>
              </div>
            </aside>

            {/* Mobile jump bar */}
            <div className="-mx-5 mb-1 overflow-x-auto px-5 lg:hidden">
              <div className="flex w-max gap-2">
                {SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => jump(s.id)}
                    className={`chip ${active === s.id ? "chip-on" : ""} !h-9 !text-[13px]`}
                  >
                    <s.icon size={14} /> {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="min-w-0 space-y-6">
              <Section id="overview" title="Selkie in one minute">
                <p>
                  Selkie turns a social handle into a real wallet. Sign in with X and{" "}
                  <span className="font-semibold text-pen">@yourhandle</span> becomes an account on
                  the Canton Network that can hold and move real value. The person you pay does not
                  need an account first. If they have never heard of Selkie, the payment itself
                  creates their wallet, and the money is already theirs.
                </p>
                <p>
                  Three things make it feel different from a normal crypto wallet. You never see a
                  seed phrase, because the wallet lives on Canton and is tied to your handle. You
                  never pay gas. And your balances and amounts are private by default: only the
                  people in a payment can see it.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { icon: <AtSign size={17} />, t: "Handle is the wallet", d: "Your @name is the address." },
                    { icon: <EyeOff size={17} />, t: "Private by default", d: "Amounts stay between you." },
                    { icon: <Zap size={17} />, t: "No gas, no seed", d: "Nothing to install or lose." },
                  ].map((c) => (
                    <div key={c.t} className="rounded-xl border-2 border-pen bg-card-bright p-4">
                      <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-pen bg-[#f7ecd2] text-gold-ink">
                        {c.icon}
                      </span>
                      <p className="mt-3 text-sm font-bold">{c.t}</p>
                      <p className="mt-0.5 text-[13px] text-pen/55">{c.d}</p>
                    </div>
                  ))}
                </div>
              </Section>

              <Section id="quickstart" title="Quick start">
                <ol className="space-y-3">
                  {[
                    ["Sign in with X", "One tap on Continue with X. Your handle becomes your wallet instantly. There is nothing to write down."],
                    ["Get paid or add funds", "Share your handle so anyone can pay you, or open Receive to get the Canton address behind it and fund it from another wallet."],
                    ["Send to a handle", "Type a handle and an amount. It settles on Canton in seconds, privately."],
                  ].map(([t, d], i) => (
                    <li key={t} className="flex gap-3.5">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-pen bg-[#f7ecd2] font-display text-sm font-bold text-gold-ink">
                        {i + 1}
                      </span>
                      <div>
                        <p className="font-bold text-pen">{t}</p>
                        <p className="text-sm text-pen/65">{d}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Section>

              <Section id="pay-on-x" title="Pay on X">
                <p>
                  This is where Selkie started. You can pay anyone straight from a post: write a
                  tweet that tags <span className="font-semibold text-pen">@SelkiePay</span> with
                  what you want to do. Selkie reads it, settles it on Canton, and replies
                  to you within a minute with a private receipt you can open in your wallet.
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border-2 border-pen bg-card-bright p-4">
                    <p className="flex items-center gap-2 font-bold">
                      <Sparkles size={16} className="text-gold-ink" /> New here? Open your wallet
                    </p>
                    <p className="mt-1.5 text-sm text-pen/65">
                      Your X handle is already your wallet. There is nothing to install and no seed
                      phrase to keep. Two ways to open it:
                    </p>
                    <ul className="mt-2.5 space-y-2 text-sm text-pen/65">
                      <li className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                        The first time anyone pays your handle on X, Selkie creates your wallet for
                        you and the money is already yours. You do nothing.
                      </li>
                      <li className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                        Or open it yourself in one tap. Sign in with X at selkiepay.vercel.app, then
                        add funds from Receive.
                      </li>
                    </ul>
                  </div>
                  <div className="rounded-xl border-2 border-pen bg-card-bright p-4">
                    <p className="flex items-center gap-2 font-bold">
                      <Zap size={16} className="text-gold-ink" /> Already set up? The flow
                    </p>
                    <ol className="mt-2.5 space-y-2 text-sm text-pen/65">
                      {[
                        "Post or reply with a command that tags @SelkiePay.",
                        "Selkie settles it on Canton and replies to you within a minute.",
                        "Tap the receipt link in the reply, or open your wallet any time to see it.",
                      ].map((s, i) => (
                        <li key={s} className="flex gap-2.5">
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-pen bg-[#f7ecd2] font-display text-[11px] font-bold text-gold-ink">
                            {i + 1}
                          </span>
                          {s}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                <div className="rounded-xl border-2 border-pen bg-[#f7ecd2] p-4">
                  <p className="text-[13px] font-bold uppercase tracking-wide text-gold-ink">
                    A full round trip
                  </p>
                  <p className="mt-2 text-sm text-pen/75">
                    You post <Code>@SelkiePay send 5 CC to @ada</Code>. Selkie replies:{" "}
                    <span className="font-semibold text-pen">
                      Transaction successful. Sent 5 CC to @ada. Settled on Canton, your balance
                      stays private.
                    </span>{" "}
                    If @ada is brand new, that same payment opens their wallet, and they sign in with
                    X to find the money waiting.
                  </p>
                </div>

                <p className="font-semibold text-pen">Every command</p>
                <p>
                  Start any command by tagging <Code>@SelkiePay</Code> in a post or a reply. Amounts
                  work with any Selkie asset: CC, USDCX, cBTC or cETH.
                </p>
                <div className="rounded-xl border-2 border-pen bg-card-bright p-4">
                  <Ref cmd={<Code>send 5 CC to @ada</Code>} desc="Pay any handle. If they are new, the payment opens their wallet." />
                  <Ref cmd={<Code>send 5 CC to @ada for lunch</Code>} desc="Add a note on the end. Only the two of you ever see it." />
                  <Ref cmd={<Code>request 10 CC from @ada</Code>} desc="Ask a handle to pay you. Nothing moves until they approve." />
                  <Ref cmd={<Code>requests</Code>} desc="See who is waiting on you." />
                  <Ref cmd={<Code>approve @ada</Code>} desc="Pay a request someone sent you. This is what moves the money." />
                  <Ref cmd={<Code>decline @ada</Code>} desc="Turn a request down. Nothing moves." />
                  <Ref cmd={<Code>balance</Code>} desc="Stays private. Selkie points you to your wallet instead of ever posting it." />
                  <Ref cmd={<Code>history</Code>} desc="Private too. Open your wallet to see your activity." />
                </div>
                <p className="text-sm text-pen/60">
                  Your balance and your history never get posted on the timeline. Tag either one and
                  Selkie just points you to your wallet, because your money is nobody else's business.
                </p>
              </Section>

              <Section id="sending" title="Sending money">
                <p>
                  Open <span className="font-semibold text-pen">Send</span> and choose how to name
                  the person you are paying. The form has one recipient field with a switch above it,
                  so the two ways never crowd each other.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border-2 border-pen bg-card-bright p-4">
                    <p className="flex items-center gap-2 font-bold">
                      <AtSign size={16} className="text-gold-ink" /> By handle
                    </p>
                    <p className="mt-1.5 text-sm text-pen/65">
                      Type <Code>@handle</Code> and an amount. If they are new to Selkie, the payment
                      creates their wallet for them.
                    </p>
                  </div>
                  <div className="rounded-xl border-2 border-pen bg-card-bright p-4">
                    <p className="flex items-center gap-2 font-bold">
                      <Fingerprint size={16} className="text-gold-ink" /> By address
                    </p>
                    <p className="mt-1.5 text-sm text-pen/65">
                      Paste a Canton address (<Code>party::fingerprint</Code>) and it settles straight
                      to that Selkie wallet, private and instant.
                    </p>
                  </div>
                </div>
                <p>
                  Either way the transfer settles on Canton and the amount stays between the two of
                  you. Your confirmation shows the handle behind the address, so you always see who
                  you actually paid.
                </p>
              </Section>

              <Section id="requests" title="Requests">
                <p>
                  A request is an ask, not a charge. It moves no money on its own. The other person
                  approves it, and approving is what settles the payment, in one atomic step. You can
                  request from someone who has never used Selkie, and their wallet is ready when they
                  answer.
                </p>
                <div className="rounded-xl border-2 border-pen bg-card-bright p-4">
                  <Ref cmd={<Code>request 10 CC from @ada</Code>} desc="Ask a handle to pay you." />
                  <Ref cmd={<Code>requests</Code>} desc="See who is waiting on you, and who you are waiting on." />
                  <Ref cmd={<Code>approve @ada</Code>} desc="Pay an open request. This is what moves the money." />
                  <Ref cmd={<Code>decline @ada</Code>} desc="Turn a request down. Nothing moves." />
                </div>
              </Section>

              <Section id="receiving" title="Receiving and funding">
                <p>
                  People on Selkie pay you by your handle, so there is usually nothing to paste. To
                  bring in funds from a wallet elsewhere on Canton, open{" "}
                  <span className="font-semibold text-pen">Receive</span> to get your Canton address.
                </p>
                <p>
                  Every token you hold lands at one personal Canton party: the real address behind
                  your handle. Send Canton Coin, cBTC or cETH to it from any Canton wallet, and Selkie
                  accepts it into your balance for you. One address for every asset, and it is the
                  same wallet your handle points to.
                </p>
              </Section>

              <Section id="assets" title="Assets">
                <p>Selkie carries the assets that live on Canton today:</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["CC", "Canton Coin", "The Canton Network's native asset."],
                    ["USDCX", "USDCx", "A digital dollar on Canton."],
                    ["CBTC", "cBTC", "Bitcoin, ported to Canton."],
                    ["CETH", "cETH", "Ether, ported to Canton."],
                  ].map(([asset, name, note]) => (
                    <div key={asset} className="flex items-center gap-3 rounded-xl border-2 border-pen bg-card-bright p-3.5">
                      <TokenIcon asset={asset} size={34} />
                      <div>
                        <p className="text-sm font-bold">{name}</p>
                        <p className="text-[13px] text-pen/55">{note}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <p>
                  cBTC and cETH are real token-standard holdings on Canton devnet, held at your own
                  party and proven on-ledger. Your balance always reads from the ledger, never from a
                  cache.
                </p>
              </Section>

              <Section id="privacy" title="Privacy">
                <p>
                  On most chains every transfer is public forever. Canton is built the other way
                  around. A payment is shared only with the parties to it, so your balance and the
                  amounts you send are visible to you and your counterparty, and to no one else.
                </p>
                <p>
                  Selkie leans into that. There is no public feed of who paid whom. A receipt is
                  readable only by the two people in the payment. Privacy is not a setting you turn
                  on. It is how the network works.
                </p>
              </Section>

              <Section id="telegram" title="Telegram">
                <p>
                  Selkie also runs as a Telegram bot,{" "}
                  <span className="font-semibold text-pen">@selkiepay_bot</span>. Your Telegram
                  username is your wallet there, the same way your X handle is on the web. Tap{" "}
                  <Code>/start</Code> and you are in. The bot has a persistent button bar and a full
                  slash-command menu.
                </p>
                <div className="rounded-xl border-2 border-pen bg-card-bright p-4">
                  <Ref cmd={<Code>send 5 CC to @ada</Code>} desc="Pay any handle." />
                  <Ref cmd={<Code>request 10 CC from @ada</Code>} desc="Ask to be paid." />
                  <Ref cmd={<Code>balance</Code>} desc="Your private balance." />
                  <Ref cmd={<Code>history</Code>} desc="Your recent activity, grouped by day." />
                  <Ref cmd={<Code>receive</Code>} desc="Your handle and Canton address." />
                </div>
                <p className="text-sm text-pen/60">
                  Your Telegram wallet and your X wallet are separate accounts, each keyed to that
                  platform's handle.
                </p>
              </Section>

              <Section id="why-canton" title="Why Canton">
                <p>
                  Selkie needs three things a payments app cannot fake: real assets, real privacy,
                  and settlement that a normal person never has to think about. Canton is the network
                  that offers all three at once.
                </p>
                <div className="space-y-3">
                  {[
                    ["Privacy is native", "Transactions are shared only with their parties. A consumer payments app has to keep balances private, and on Canton that is the default rather than a bolt-on."],
                    ["Real, interoperable assets", "Canton Coin is the native asset, and Bitcoin and Ether arrive as cBTC and cETH through one shared token standard. Selkie speaks that standard, so every asset moves through the same path."],
                    ["Settlement without gas games", "Payments settle deterministically. There is no public mempool to front-run and no gas auction for a user to lose money in. That is what lets a handle-to-handle payment feel instant."],
                  ].map(([t, d]) => (
                    <div key={t} className="rounded-xl border-2 border-pen bg-card-bright p-4">
                      <p className="font-bold text-pen">{t}</p>
                      <p className="mt-1 text-sm text-pen/65">{d}</p>
                    </div>
                  ))}
                </div>
              </Section>

              <Section id="architecture" title="How it works underneath">
                <p>
                  Every handle gets its own Canton party: the address behind the name. That party is
                  where real tokens arrive, and Selkie accepts incoming token-standard transfers into
                  it for you, so you never touch a pending-transfer screen.
                </p>
                <div className="space-y-3">
                  {[
                    [<Boxes size={16} key="i" />, "Per-handle party", "Canton Coin, cBTC and cETH all land at one personal party per handle. It is the on-ledger identity your address points to."],
                    [<Layers size={16} key="i" />, "One token standard", "Every asset moves through the CIP-56 token standard: the same two ledger interfaces start and accept a transfer, so Selkie handles CC, cBTC and cETH with one code path."],
                    [<Zap size={16} key="i" />, "Instant between handles", "Handle-to-handle payments settle instantly and privately, then the network keeps the real backing in step."],
                  ].map(([icon, t, d]) => (
                    <div key={t as string} className="flex gap-3.5 rounded-xl border-2 border-pen bg-card-bright p-4">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-pen bg-[#f7ecd2] text-gold-ink">
                        {icon}
                      </span>
                      <div>
                        <p className="font-bold text-pen">{t as string}</p>
                        <p className="mt-0.5 text-sm text-pen/65">{d as string}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              <Section id="roadmap" title="Roadmap">
                <p>What is next for Selkie:</p>
                <div className="space-y-2.5">
                  {[
                    ["On and off ramp", "Move between local money and Selkie balances, so funding a wallet and cashing out are as simple as the rest of the app.", "Planned"],
                    ["Send to any Canton wallet", "Withdraw to a non-Selkie Canton address, not just between Selkie wallets.", "Planned"],
                    ["Rewards and splits", "Reward the top replies to a post, or split a bill across many handles at once.", "Exploring"],
                  ].map(([t, d, tag]) => (
                    <div key={t} className="flex items-start justify-between gap-4 rounded-xl border-2 border-pen bg-card-bright p-4">
                      <div>
                        <p className="font-bold text-pen">{t}</p>
                        <p className="mt-0.5 text-sm text-pen/65">{d}</p>
                      </div>
                      <span className="shrink-0 rounded-full border-2 border-pen/15 bg-[#f7ecd2] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-gold-ink">
                        {tag}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>

              <Section id="vision" title="The bigger picture">
                <p>
                  The wallet is real today. But once a handle is an account and privacy is the
                  default, the same foundation opens onto much bigger things. Here is where Selkie
                  is headed.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    [<TrendingUp size={16} key="i" />, "Prediction markets", "Back your take with your balance. Join or create a market on any question, take your position privately, and settle in cBTC, cETH or Canton Coin. No public bet slip, no middleman."],
                    [<Users size={16} key="i" />, "Group savings pools", "Start a shared pot with friends by their handles. Everyone chips in and it pays out on a schedule or a goal: the savings circles millions already trust, now instant and private."],
                    [<Globe size={16} key="i" />, "Cross-border by handle", "Send money home to a handle, settled in seconds in a digital dollar, with no exchange and no wire. Whoever you paid just signs in with their handle to receive it."],
                    [<Store size={16} key="i" />, "Handle as a storefront", "Turn any handle into a way to get paid. Share one link, take money from anyone, and keep the takings private. No terminal and no merchant account."],
                    [<HandCoins size={16} key="i" />, "Payroll and mass payouts", "Pay a whole team or community in one move, each person by their handle. The payout engine already runs behind Selkie's reward tools."],
                    [<Repeat size={16} key="i" />, "Subscriptions", "Support a creator or cover a bill on a repeat, by handle, and stop it any time you like."],
                  ].map(([icon, t, d]) => (
                    <div key={t as string} className="rounded-xl border-2 border-pen bg-card-bright p-4">
                      <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-pen bg-[#f7ecd2] text-gold-ink">
                        {icon}
                      </span>
                      <p className="mt-3 text-sm font-bold">{t as string}</p>
                      <p className="mt-0.5 text-[13px] text-pen/55">{d as string}</p>
                    </div>
                  ))}
                </div>
              </Section>

              <div className="chunk-gold flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
                <div>
                  <p className="font-display text-xl font-bold text-pen">Ready to try it?</p>
                  <p className="mt-1 text-sm text-pen/70">Your handle is already a wallet.</p>
                </div>
                <Link href="/dashboard/activity" className="btn btn-dark shrink-0">
                  Open your wallet <ArrowUpRight size={16} />
                </Link>
              </div>
            </div>
          </div>
        </Shell>
      </main>
      <Footer />
    </>
  );
}
