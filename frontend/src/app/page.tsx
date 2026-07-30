"use client";

import { Suspense, useEffect, useRef, useState, type SubmitEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, AtSign, EyeOff, Lock, Send, Zap } from "lucide-react";
import { Footer, Header, Shell, Spinner } from "@/components/Layout";
import { XLogo } from "@/components/Mark";
import { Reveal } from "@/components/Reveal";
import { TokenIcon } from "@/components/TokenIcon";
import { useAuth } from "@/contexts/useAuth";

/* Illustrative wallet for "@yourhandle": what the product feels like. */
const CARD_ROWS = [
  { asset: "CC", sym: "CC", name: "Canton Coin", amount: "1,284.09" },
  { asset: "USDCX", sym: "USDCx", name: "Digital dollar", amount: "250.00" },
  { asset: "CBTC", sym: "cBTC", name: "Bitcoin on Canton", amount: "0.0500" },
  { asset: "CETH", sym: "cETH", name: "Ether on Canton", amount: "1.2500" },
];

const MARQUEE = [
  { asset: "CC", text: <>@dara sent <b>25 CC</b> to @ben</> },
  { asset: "CBTC", text: <>@theo sent <b>0.01 cBTC</b> to @ada</> },
  { asset: "CC", text: <>@mira paid <b>20 winners</b> 5 CC each</> },
  { asset: "USDCX", text: <>@ada sent <b>100 USDCx</b> to @cleo</> },
  { asset: "CETH", text: <>@ben sent <b>0.2 cETH</b> to @mira</> },
  { asset: "CC", text: <>@noah sent <b>75 CC</b> to @tayo</> },
];

const STEPS = [
  {
    n: "01",
    icon: <Zap size={19} />,
    title: "Sign in with X",
    body: "One tap. Your handle becomes your wallet. Nothing to install, nothing to write down, nothing to lose.",
  },
  {
    n: "02",
    icon: <Send size={19} />,
    title: "Pay any @handle",
    body: "Type a handle and an amount. If they have never heard of Selkie, the payment itself creates their wallet.",
  },
  {
    n: "03",
    icon: <EyeOff size={19} />,
    title: "Stay private",
    body: "Amounts and balances are visible only to the people in the payment. On Canton, privacy is the default.",
  },
];

const ASSET_TILES = [
  { asset: "CC", name: "Canton Coin", note: "The Canton Network's native asset." },
  { asset: "USDCX", name: "USDCx", note: "A digital dollar on Canton." },
  { asset: "CBTC", name: "cBTC", note: "Bitcoin, ported to Canton." },
  { asset: "CETH", name: "cETH", note: "Ether, ported to Canton." },
];

/**
 * The hero object: an ivory wallet card floating in the water, tilting toward
 * the cursor. The balances sit frosted until you hover, which is the product
 * thesis rendered literally: the value is there, and only leaning in reveals it.
 */
function WalletCard() {
  const card = useRef<HTMLDivElement>(null);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = card.current;
    if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--ry", `${(x - 0.5) * 10}deg`);
    el.style.setProperty("--rx", `${(0.5 - y) * 10}deg`);
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
  }
  function onLeave() {
    const el = card.current;
    if (!el) return;
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--rx", "0deg");
  }

  return (
    <div className="tilt-wrap relative mx-auto w-full max-w-sm" onMouseMove={onMove} onMouseLeave={onLeave}>
      <span className="orb -right-10 -top-12 h-64 w-64 bg-gold/25" style={{ animation: "drift 7s ease-in-out infinite" }} />
      <span className="orb -bottom-16 -left-12 h-56 w-56 bg-[#7ebed4]/15" style={{ animation: "drift 9s ease-in-out infinite reverse" }} />

      <div ref={card} className="tilt-card chunk p-6 sm:p-7">
        <span className="card-shine" />

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full border-2 border-pen bg-card-bright text-gold-ink">
              <AtSign size={17} />
            </span>
            <div>
              <p className="font-display text-[1.05rem] font-bold leading-tight">@yourhandle</p>
              <p className="text-xs font-medium text-pen/50">Private wallet · Canton</p>
            </div>
          </div>
          <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-pen bg-[#f7ecd2] text-gold-ink">
            <Lock size={13} />
          </span>
        </div>

        <div className="rule my-5" />

        <ul>
          {CARD_ROWS.map((row) => (
            <li key={row.asset} className="flex items-center gap-3 border-b-2 border-pen/10 py-3 last:border-0">
              <TokenIcon asset={row.asset} size={34} />
              <div className="leading-tight">
                <p className="text-sm font-bold">{row.sym}</p>
                <p className="text-xs font-medium text-pen/45">{row.name}</p>
              </div>
              <span className="veil num ml-auto text-[1.05rem] font-bold">{row.amount}</span>
            </li>
          ))}
        </ul>

        <p className="mt-4 flex items-center gap-1.5 text-xs font-medium text-pen/50">
          <Lock size={11} /> Only @yourhandle can see these. Hover to peek.
        </p>
      </div>
    </div>
  );
}

/**
 * The descent driver. While the landing is mounted it writes two unitless
 * vars on <html> every frame: --sy (scrollY) and --depthp (0..1 progress),
 * and the CSS does the rest: the moonlight recedes, the floor approaches,
 * the water darkens, the hero drifts away. It also renders the depth gauge,
 * whose meter reading it updates directly (no re-renders at scroll speed).
 * Skipped entirely under prefers-reduced-motion; vars are removed on
 * unmount so every other page stays still.
 */
function DepthMeter() {
  const read = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    let raf = 0;
    const frame = () => {
      raf = 0;
      const max = Math.max(1, root.scrollHeight - window.innerHeight);
      const sy = window.scrollY;
      const p = Math.min(1, sy / max);
      root.style.setProperty("--sy", String(sy));
      root.style.setProperty("--depthp", p.toFixed(4));
      if (read.current) read.current.textContent = String(Math.round(p * 40));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    frame();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
      root.style.removeProperty("--sy");
      root.style.removeProperty("--depthp");
    };
  }, []);

  return (
    <div className="depth-meter" aria-hidden="true">
      <span className="depth-track">
        <span className="depth-fill" />
      </span>
      <span className="depth-read">
        <span ref={read}>0</span> m
      </span>
    </div>
  );
}

/** One input on the whole landing: open any handle's pay page. */
function PayAHandle() {
  const [value, setValue] = useState("");
  const router = useRouter();

  function go(e: SubmitEvent) {
    e.preventDefault();
    const handle = value.replace(/^@+/, "").trim();
    if (handle) router.push(`/account/${handle}`);
  }

  return (
    <form onSubmit={go} className="mx-auto mt-9 flex w-full max-w-sm items-center gap-2.5">
      <div className="relative flex flex-1 items-center">
        <span className="pointer-events-none absolute left-4 font-semibold text-pen/40">@</span>
        <input
          className="field pl-9"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="open someone's pay page"
          autoComplete="off"
          spellCheck={false}
          aria-label="X handle to pay"
        />
      </div>
      <button type="submit" aria-label="Open pay page" className="btn btn-gold h-12 w-12 shrink-0 !p-0">
        <ArrowRight size={17} />
      </button>
    </form>
  );
}

function Home() {
  const { me, loading } = useAuth();
  const params = useSearchParams();

  if (loading) return <Spinner />;

  const loginUnavailable = params.get("login") === "unavailable";

  // Signed-in visitors still get the landing; the ask just changes.
  const cta = me ? (
    <Link href="/dashboard/activity" className="btn btn-gold">
      Open your wallet <ArrowRight size={16} />
    </Link>
  ) : (
    <a href="/auth/x/login" className="btn btn-gold">
      <XLogo size={15} /> Continue with X
    </a>
  );

  return (
    <>
      <Header />
      <DepthMeter />

      <main>
        {/* ---- hero ---- */}
        <Shell wide>
          <div className="grid items-center gap-14 pb-16 pt-14 sm:pt-20 lg:grid-cols-2 lg:gap-10">
            {/* Parallax wrappers, entrance animation inside: `animate-rise`
                fills its transform forever, so the scroll drift that follows
                it needs an element of its own. */}
            <div className="par-a par-fade">
              <div className="animate-rise">
                <span className="chunk inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-gold-deep" />
                  Live on Canton devnet
                </span>

                <h1 className="mt-6 font-display text-[clamp(2.9rem,6.5vw,4.6rem)] font-bold leading-[1.02] tracking-[-0.03em] text-balance">
                  Pay a handle.
                  <br />
                  <span className="text-gold-grad">Not an address.</span>
                </h1>

                <p className="mt-6 max-w-md text-[1.05rem] leading-relaxed text-ivory/70">
                  Selkie turns any X handle into a private wallet on Canton. Send CC, USDCx, cBTC
                  or cETH to @anyone. If they have never used Selkie, your payment creates their
                  wallet the moment it lands.
                </p>

                <div className="mt-9 flex flex-wrap items-center gap-3.5">
                  {cta}
                  <a href="#how" className="btn btn-dim">
                    How it works
                  </a>
                  <Link
                    href="/docs"
                    className="text-sm font-semibold text-ivory/70 underline-offset-4 hover:text-ivory hover:underline"
                  >
                    Read the docs
                  </Link>
                </div>

                {loginUnavailable && !me && (
                  <p className="chunk mt-5 max-w-md px-4 py-3 text-[13px] font-medium leading-relaxed text-pen/80">
                    X sign-in is coded and ready but this deployment is missing its X API keys. Set
                    X_CLIENT_ID and X_CLIENT_SECRET on the server to switch it on.
                  </p>
                )}

                <p className="mt-7 text-[13px] font-medium text-ivory/55">
                  No app · No seed phrase · No gas · No public balances
                </p>
              </div>
            </div>

            <div className="par-b par-fade">
              <div className="animate-rise [animation-delay:150ms]">
                <WalletCard />
              </div>
            </div>
          </div>
        </Shell>

        {/* ---- live-feel marquee ---- */}
        <div className="marquee">
          {[0, 1].map((copy) => (
            <div className="marquee-track" key={copy} aria-hidden={copy === 1}>
              {MARQUEE.map((item, i) => (
                <span key={i} className="cmd">
                  <TokenIcon asset={item.asset} size={16} />
                  {item.text}
                </span>
              ))}
            </div>
          ))}
        </div>

        {/* ---- how it works ---- */}
        <Shell wide>
          <section id="how" className="pt-24">
            <Reveal>
              <p className="eyebrow">How it works</p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
                Three steps, zero crypto homework.
              </h2>
            </Reveal>

            {/* The three steps converge: outer cards sail in from their own
                side, the middle one surfaces between them. */}
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <Reveal
                  key={step.n}
                  delay={i * 130}
                  variant={i === 0 ? "left" : i === 1 ? "pop" : "right"}
                >
                  <div className="chunk h-full overflow-hidden p-7">
                    <span className="pointer-events-none absolute right-5 top-1 select-none font-display text-[4.5rem] font-bold text-pen/[0.07]">
                      {step.n}
                    </span>
                    <span className="grid h-11 w-11 place-items-center rounded-xl border-2 border-pen bg-[#f7ecd2] text-gold-ink">
                      {step.icon}
                    </span>
                    <h3 className="mt-5 font-display text-lg font-bold">{step.title}</h3>
                    <p className="mt-2 text-sm font-medium leading-relaxed text-pen/60">{step.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>

          {/* ---- assets ---- */}
          <section className="pt-24">
            <Reveal>
              <p className="eyebrow">Assets</p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
                Send what you want.
              </h2>
              <p className="mt-3 max-w-lg text-ivory/65">
                One handle holds them all, and every balance stays between you and whoever you pay.
              </p>
            </Reveal>

            <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {ASSET_TILES.map((t, i) => (
                <Reveal key={t.asset} delay={i * 90} variant="pop">
                  <div className="chunk chunk-pop h-full p-5">
                    <TokenIcon asset={t.asset} size={44} />
                    <p className="mt-4 font-display text-lg font-bold">{t.name}</p>
                    <p className="mt-1 text-[13px] font-medium leading-relaxed text-pen/55">{t.note}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>

          {/* ---- closing CTA ---- */}
          <section className="pt-24">
            <Reveal variant="pop">
              <div className="chunk-gold overflow-hidden p-10 text-center sm:p-14">
                <h2 className="font-display text-[clamp(1.9rem,4.5vw,2.9rem)] font-bold tracking-tight text-balance">
                  Your handle is already a wallet.
                </h2>
                <p className="mx-auto mt-3 max-w-md font-medium text-pen/70">
                  Claim it in one tap, or pay someone who has not claimed theirs yet.
                </p>
                <div className="mt-8 flex justify-center">{cta}</div>
                <PayAHandle />
              </div>
            </Reveal>
          </section>
        </Shell>
      </main>

      <Footer />
    </>
  );
}

/**
 * `useSearchParams` opts a client component out of static rendering unless it
 * sits under a Suspense boundary, so the landing keeps its prerendered shell
 * and only the part that reads the query string streams in.
 */
export default function HomePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Home />
    </Suspense>
  );
}
