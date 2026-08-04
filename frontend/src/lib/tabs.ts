import {
  ArrowDownToLine,
  HandCoins,
  Home,
  Send,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/**
 * The wallet's tabs, in the order they appear.
 *
 * Home is first because the first question anyone opens a wallet with is "how
 * much do I have", not "what happened". Activity used to lead, which answered a
 * question nobody asked first and made the app feel like a ledger rather than
 * somewhere your money lives. History now sits under the balance on Home, where
 * it is read after the number rather than instead of it.
 */
export type WalletTab = "home" | "send" | "receive" | "requests" | "many" | "settings";

export interface TabDef {
  id: WalletTab;
  label: string;
  /** The short label, for the phone bar where space is measured in pixels. */
  short: string;
  icon: LucideIcon;
  /** Whether it earns a place under the thumb. Not everything does. */
  onPhone: boolean;
}

export const TABS: TabDef[] = [
  { id: "home", label: "Home", short: "Home", icon: Home, onPhone: true },
  { id: "send", label: "Send", short: "Send", icon: Send, onPhone: true },
  { id: "receive", label: "Deposit", short: "Deposit", icon: ArrowDownToLine, onPhone: true },
  { id: "requests", label: "Requests", short: "Requests", icon: HandCoins, onPhone: true },
  { id: "many", label: "Pay many", short: "Many", icon: Sparkles, onPhone: true },
  { id: "settings", label: "Settings", short: "Settings", icon: Settings, onPhone: false },
];

export const PHONE_TABS = TABS.filter((tab) => tab.onPhone);

/** Guards the URL: /wallet/anything-else is not a tab, it is a typo. */
export const isWalletTab = (value: string): value is WalletTab =>
  TABS.some((tab) => tab.id === value);
