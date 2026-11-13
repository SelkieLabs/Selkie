"use client";

import { Redirect } from "@/components/Redirect";
import { StellarLanding } from "@/components/landing/StellarLanding";
import { TideLanding } from "@/components/landing/tide/TideLanding";
import { useAuth } from "@/contexts/useAuth";
import { isNear } from "@/lib/chain";
import { hasPayLink } from "@/lib/pay-link";

export default function Landing() {
  const { status } = useAuth();

  // Someone with an account came for their wallet, not the pitch. If they
  // typed a handle into the landing's box before signing in, Send opens with it.
  if (status === "ready" || status === "needs-account") {
    const to = hasPayLink("pay") ? "/wallet/send" : hasPayLink("pocket") ? "/wallet/pocket" : "/wallet/home";
    return <Redirect to={to} />;
  }

  // `loading` deliberately falls through to the page. The landing is the one
  // screen that must render before we know who is looking at it: a spinner here
  // would mean an empty page for anyone arriving from a link or a search.
  return isNear ? <TideLanding /> : <StellarLanding />;
}
