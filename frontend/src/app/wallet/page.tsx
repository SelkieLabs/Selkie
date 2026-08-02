import { redirect } from "next/navigation";

/**
 * /wallet has no screen of its own: the wallet is its tabs, and activity is the
 * one you want when you have not said otherwise. Redirecting on the server keeps
 * every old link, bookmark and menu item working without a flash of empty page.
 */
export default function WalletIndexPage() {
  redirect("/wallet/activity");
}
