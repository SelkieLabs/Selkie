import {
  Activity as ActivityIcon,
  ArrowDownToLine,
  HandCoins,
  Send,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/** The five things a wallet is for. The order is the order of the rail. */
export type WalletTab = "activity" | "send" | "receive" | "requests" | "many";

export const TABS: { id: WalletTab; label: string; icon: LucideIcon }[] = [
  { id: "activity", label: "Activity", icon: ActivityIcon },
  { id: "send", label: "Send", icon: Send },
  { id: "receive", label: "Add money", icon: ArrowDownToLine },
  { id: "requests", label: "Requests", icon: HandCoins },
  { id: "many", label: "Pay many", icon: Sparkles },
];

/** Guards the URL: /wallet/anything-else is not a tab, it is a typo. */
export const isWalletTab = (value: string): value is WalletTab =>
  TABS.some((tab) => tab.id === value);
