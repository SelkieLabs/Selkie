import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Scene } from "@/components/Scene";
import { isNear } from "@/lib/chain";
import { RETURNING_SCRIPT } from "@/lib/session-hint";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = isNear
  ? {
      title: "Selkie: send money to any X handle, on NEAR",
      description:
        "Send USDC to any X handle on NEAR. The person you pay needs no app, no wallet and no gas. If they have not joined yet, it waits until they sign in with X.",
      icons: { icon: "/mark.svg", apple: "/apple-touch-icon.png" },
      openGraph: {
        type: "website",
        title: "Selkie on NEAR",
        description: "Send USDC to any X handle. No app, no wallet, no gas.",
      },
    }
  : {
      title: "Selkie: send money to anyone with a handle",
      description:
        "Send money to any X handle. The person receiving it needs no app, no wallet and no seed phrase. If they have not joined yet, it waits for them.",
      icons: { icon: "/mark.svg", apple: "/apple-touch-icon.png" },
      openGraph: {
        type: "website",
        title: "Selkie",
        description: "Send money to any X handle. No app, no wallet, no seed phrase.",
      },
    };

export const viewport: Viewport = {
  themeColor: "#04101a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

/**
 * The shell every route renders inside. The scene and the providers live here
 * rather than in each page, so the sea never remounts and the session is
 * resolved once for the whole app.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* Before first paint: someone signed in last time sees the loader, not the landing. */}
        <script dangerouslySetInnerHTML={{ __html: RETURNING_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Bricolage carries the display voice (variable, with an optical size
            axis, so headlines and card titles are each drawn for their size).
            Geist is the body, Geist Mono the account names and numbers, and
            Instrument Serif the one italic accent line on the landing. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <Scene />
          {children}
        </Providers>
      </body>
    </html>
  );
}
