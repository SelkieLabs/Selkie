import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Metadata for the pitch, which the page itself cannot export because it is a
 * client component (the PDF button needs the browser). This is the link that
 * gets pasted into investor threads, so the card matters as much as the page.
 */
export const metadata: Metadata = {
  title: "Selkie — the pitch",
  description:
    "Send money to any handle, including people who have never heard of us. Live on Stellar testnet. What works today, how it works, and what we are raising for.",
  openGraph: {
    type: "article",
    title: "Selkie — the pitch",
    description:
      "Money that arrives before the person does. Live on Stellar testnet. What works, what does not, and what we are raising for.",
  },
};

export default function PitchLayout({ children }: { children: ReactNode }) {
  return children;
}
