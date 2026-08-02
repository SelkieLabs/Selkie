"use client";

import { ArrowRight, Clock, Send, Sparkles } from "lucide-react";
import { Footer, Header, Shell } from "@/components/Layout";
import { Redirect } from "@/components/Redirect";
import { Reveal } from "@/components/Reveal";
import { useAuth } from "@/contexts/useAuth";

const STEPS = [
  {
    icon: Send,
    title: "Type a handle",
    body: "Any X handle. You do not need their address, their phone number, or their permission.",
  },
  {
    icon: Clock,
    title: "Send the money",
    body: "If they have not joined yet, it waits for them. Nobody holds it, not even us.",
  },
  {
    icon: Sparkles,
    title: "They sign in",
    body: "One tap with X and the money is theirs. No app, no seed phrase, nothing to write down.",
  },
];

export default function Landing() {
  const { status, signIn } = useAuth();

  // Someone with an account came for their wallet, not the pitch.
  if (status === "ready" || status === "needs-account") return <Redirect to="/wallet/activity" />;

  // `loading` deliberately falls through to the page. The landing is the one
  // screen that must render before we know who is looking at it: a spinner here
  // would mean an empty page for anyone arriving from a link or a search.

  return (
    <>
      <Header />

      <main>
        <Shell wide>
          <section className="pb-16 pt-16 sm:pt-24">
            <Reveal>
              <p className="eyebrow">Money that finds people</p>
              <h1 className="text-balance mt-4 max-w-3xl font-display text-[2.6rem] font-bold leading-[1.05] tracking-tight text-ivory sm:text-6xl">
                Send money to anyone. Even if they have never heard of us.
              </h1>
              <p className="text-balance mt-6 max-w-xl text-lg leading-relaxed text-ivory/70">
                Pay any X handle in seconds. There is nothing for them to install and nothing for
                you to set up. If they have not joined yet, the money simply waits.
              </p>
            </Reveal>

            <Reveal delay={120}>
              <div className="mt-9 flex flex-wrap items-center gap-4">
                <button onClick={signIn} disabled={status === "loading"} className="btn btn-gold">
                  Get started <ArrowRight size={17} strokeWidth={2.5} />
                </button>
                <span className="text-[15px] font-semibold text-ivory/50">
                  Continue with Google or X. It takes one tap.
                </span>
              </div>
            </Reveal>
          </section>

          <section className="grid gap-5 pb-20 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <Reveal key={step.title} delay={index * 110} variant="pop">
                <div className="chunk h-full p-6">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-gold/[0.18] text-gold-ink">
                    <step.icon size={20} strokeWidth={2.2} />
                  </span>
                  <p className="mt-4 font-display text-lg font-bold tracking-tight">{step.title}</p>
                  <p className="mt-2 text-[15px] leading-relaxed text-pen/65">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </section>

          <Reveal>
            <section className="chunk-gold mb-6 flex flex-col items-center gap-5 p-9 text-center">
              <h2 className="text-balance max-w-lg font-display text-3xl font-bold leading-tight tracking-tight">
                Your money, at a name people already know you by
              </h2>
              <p className="max-w-md text-[15px] leading-relaxed text-pen/70">
                No addresses to copy. No fees to fund. Just a handle and an amount.
              </p>
              <button onClick={signIn} disabled={status === "loading"} className="btn btn-dark">
                Open your wallet <ArrowRight size={17} strokeWidth={2.5} />
              </button>
            </section>
          </Reveal>
        </Shell>
      </main>

      <Footer />
    </>
  );
}
