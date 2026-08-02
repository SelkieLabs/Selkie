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
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap"
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
