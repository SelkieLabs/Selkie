"use client";

import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { AuthProvider } from "@/contexts/AuthContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { features } from "@/lib/chain";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Everything the app needs before it can show anything.
 *
 * Privy is the door: it runs the logins and hands back an access token.
 * Selkie issues no session of its own, so this provider sits above
 * AuthProvider, which trades that token for a Selkie account.
 *
 * On NEAR, X is the only door: the account is named after the X handle. The
 * user's NEAR key is a Privy embedded wallet, created on first sign-in by
 * AuthProvider (extended chains have no createOnLogin). EVM and Solana
 * wallets stay off; Selkie has no use for them.
 */
const LOGIN_METHODS = [
  ...(features.google ? (["google"] as const) : []),
  "twitter" as const,
  ...(features.telegram ? (["telegram"] as const) : []),
];

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Google is a door only; X and Telegram are also addresses people can
        // be paid at, which is why linking one is what releases escrowed money.
        loginMethods: LOGIN_METHODS,
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
        appearance: {
          theme: "dark",
          accentColor: "#d9a85c",
          logo: "/mark.svg",
          landingHeader: "Welcome to Selkie",
          loginMessage: features.google
            ? "Send money to anyone with a handle."
            : "Sign in with X. Your account is named after your handle.",
        },
      }}
    >
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </PrivyProvider>
  );
}
