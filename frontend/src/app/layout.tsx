import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Scene } from "@/components/Scene";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Selkie: send money to anyone with a handle",
  description:
    "Send money to any X handle. The person receiving it needs no app, no wallet and no seed phrase. If they have not joined yet, it waits for them.",
  icons: { icon: "/mark.svg" },
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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Bricolage carries the display voice: variable, with an optical size
            axis, so a 5rem headline and a 1rem card title are each drawn for
            the size they are set at rather than scaled from one master. Space
            Grotesk stays as the fallback the wallet was built against. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap"
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
