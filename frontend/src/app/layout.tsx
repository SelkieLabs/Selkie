import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { Scene } from "@/components/Scene";
import "./globals.css";

export const metadata: Metadata = {
  title: "Selkie — a private wallet for any X handle",
  description:
    "Turn any X handle into a private wallet on Canton. Send CC, USDCx, cBTC or cETH to @anyone. No app, no seed phrase, no gas, no public balance.",
  icons: { icon: "/mark.svg" },
  openGraph: {
    type: "website",
    title: "Selkie",
    description: "Turn any X handle into a private wallet on Canton.",
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
 * fetched once for the whole app.
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
        <AuthProvider>
          <ToastProvider>
            <Scene />
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
