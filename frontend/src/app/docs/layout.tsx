import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Metadata for the docs, which the page itself cannot export because it is a
 * client component. It matters here more than on most routes: this is the link
 * the bot posts on X, so this is the card people see before they click.
 */
export const metadata: Metadata = {
  title: "How Selkie works",
  description:
    "Everything Selkie does, in plain language. Send money to any handle, from the app or straight from a post. The person receiving it needs no app and no wallet.",
  openGraph: {
    type: "article",
    title: "How Selkie works",
    description:
      "Everything Selkie does, in plain language. Send money to any handle, from the app or straight from a post.",
  },
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return children;
}
