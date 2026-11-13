"use client";

import { Suspense, useEffect, useMemo } from "react";
import { AlertTriangle, ArrowRight, HandCoins, Send, Zap } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { Header, Spinner } from "@/components/Layout";
import { Redirect } from "@/components/Redirect";
import { useAuth } from "@/contexts/useAuth";
import { usd } from "@/lib/format";
import { readPayLink, savePayLink, type PayLinkKind } from "@/lib/pay-link";

const WHERE: Record<PayLinkKind, string> = { pay: "/wallet/send", ask: "/wallet/requests", pocket: "/wallet/pocket" };

/**
 * Where a link from the X bot lands: `/pay/amaka?amount=5` or `/ask/amaka?amount=5`.
 *
 * Signed in, it goes straight to Send (or Requests) with the form filled in.
 * Signed out, it says what the link is for and offers the X sign-in first, so
 * the person knows what they are signing in to do. Either way the link is kept
 * in this browser before anything else happens, because the sign-in can leave
 * the page and come back.
 */
export function PayLinkPage({ kind }: { kind: PayLinkKind }) {
  // useSearchParams needs a Suspense boundary, or Next renders the whole route
  // on the client with no fallback.
  return (
    <Suspense fallback={<Spinner />}>
      <PayLinkBody kind={kind} />
    </Suspense>
  );
}

function PayLinkBody({ kind }: { kind: PayLinkKind }) {
  const params = useParams<{ handle: string }>();
  const search = useSearchParams();
  const { status, signIn, problem } = useAuth();

  const link = useMemo(
    () => readPayLink(kind, params?.handle ?? "", new URLSearchParams(search?.toString() ?? "")),
    [kind, params?.handle, search],
  );

  useEffect(() => {
    if (link) savePayLink(link);
  }, [link]);

  // A link that names nobody is not worth a screen.
  if (!link) return <Redirect to="/" />;
  // needs-account goes on too: the wallet opens the account first, then Send.
  if (status === "ready" || status === "needs-account") return <Redirect to={WHERE[kind]} />;
  if (status === "loading") return <Spinner />;

  const amount = link.amount ? usd(link.amount) : null;
  const Icon = kind === "pay" ? Send : kind === "pocket" ? Zap : HandCoins;
  const title =
    kind === "pay"
      ? `Send ${amount ?? "money"} to @${link.handle}`
      : kind === "pocket"
        ? "Let your tweets pay"
        : `Ask @${link.handle} for ${amount ?? "money"}`;

  return (
    <>
      <Header />
      <div className="flex min-h-[80vh] items-center justify-center px-5">
        <div className="chunk w-full max-w-md p-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gold/20 text-gold-ink">
            <Icon size={24} strokeWidth={2.2} />
          </span>
          <h1 className="mt-5 font-display text-[1.7rem] font-bold leading-tight tracking-tight">
            {title}
          </h1>
          {link.note && <p className="mt-2 text-[15px] italic text-pen/60">&ldquo;{link.note}&rdquo;</p>}
          <p className="mt-3 text-[15px] leading-relaxed text-pen/65">
            {kind === "pay"
              ? "Sign in with X and it opens ready to check. Nothing moves until you confirm it, and your own key signs it."
              : kind === "pocket"
                ? `Fill your X pocket once, and a tweet like “send ${amount ?? "2"} to @${link.handle}” pays them on the spot, up to a daily limit you set. Withdraw it any time.`
                : "Sign in with X and the request opens ready to check. Nothing is sent until you confirm it."}
          </p>

          <button onClick={signIn} className="btn btn-gold mt-7 w-full">
            Continue with X <ArrowRight size={17} strokeWidth={2.5} />
          </button>

          {problem && (
            <p className="mt-5 flex items-start gap-2.5 rounded-xl border border-gold/25 bg-gold/[0.08] p-3.5 text-left text-[14px] leading-relaxed text-pen/80">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-gold" />
              {problem}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
