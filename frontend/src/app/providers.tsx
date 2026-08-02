"use client";

import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { AuthProvider } from "@/contexts/AuthContext";
import { ToastProvider } from "@/contexts/ToastContext";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Everything the app needs before it can show anything.
 *
 * Privy is the door: it runs the Google and X logins and hands back an access
 * token. Selkie issues no session of its own, so this provider sits above
 * AuthProvider, which trades that token for a Selkie account.
 *
 * Embedded wallets are deliberately off. Selkie provisions the Stellar account
 * itself, lazily, the first time money touches it, because every real account
 * costs sponsored reserves and most sign-ups never transact.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["google", "twitter"],
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
        appearance: {
          theme: "dark",
          accentColor: "#d9a85c",
          logo: "/mark.svg",
          landingHeader: "Welcome to Selkie",
          loginMessage: "Send money to anyone with a handle.",
        },
      }}
    >
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </PrivyProvider>
  );
}
