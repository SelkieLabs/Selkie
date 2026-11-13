"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Layout";
import { Redirect } from "@/components/Redirect";
import { StellarLanding } from "@/components/landing/StellarLanding";
import { TideLanding } from "@/components/landing/tide/TideLanding";
import { useAuth } from "@/contexts/useAuth";
import { isNear } from "@/lib/chain";
import { hasPayLink } from "@/lib/pay-link";

/** Where someone signed in is going: a waiting pay or pocket link first, else Home. */
function walletTarget(): string {
  return hasPayLink("pay") ? "/wallet/send" : hasPayLink("pocket") ? "/wallet/pocket" : "/wallet/home";
}

export default function Landing() {
  const { status } = useAuth();
  const router = useRouter();

  // Someone signed in here last time (marked in <head> before first paint):
  // open the wallet now, while the session is still being confirmed, instead
  // of showing the landing and then jumping. The wallet shows its own loader,
  // and sends them back here if the session turns out to be gone.
  useEffect(() => {
    if (status === "loading" && document.documentElement.hasAttribute("data-returning")) {
      router.replace(walletTarget());
    }
    // Signed out after all: show the landing.
    if (status === "signed-out") document.documentElement.removeAttribute("data-returning");
  }, [status, router]);

  // Someone with an account came for their wallet, not the pitch. If they
  // typed a handle into the landing's box before signing in, Send opens with it.
  if (status === "ready" || status === "needs-account") return <Redirect to={walletTarget()} />;

  // `loading` deliberately falls through to the page. The landing is the one
  // screen that must render before we know who is looking at it: a spinner here
  // would mean an empty page for anyone arriving from a link or a search. Both
  // are rendered; CSS shows the loader instead only to a returning visitor.
  return (
    <>
      <div className="returning-only">
        <Spinner />
      </div>
      <div className="landing-only">{isNear ? <TideLanding /> : <StellarLanding />}</div>
    </>
  );
}
