"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "./Layout";

/**
 * A client-side redirect rendered from a screen that has already started:
 * signed-out visitors leaving the wallet, an unknown tab. Replaces the entry
 * so Back doesn't bounce you straight into the page you were just sent away
 * from.
 */
export function Redirect({ to }: { to: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(to);
  }, [router, to]);

  return <Spinner />;
}
