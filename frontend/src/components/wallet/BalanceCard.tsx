"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Repeat,
  RefreshCw,
  Send,
} from "lucide-react";
import { TokenIcon } from "@/components/TokenIcon";
import { useToast } from "@/contexts/ToastContext";
import type { Money, User } from "@/lib/api";
import { DOLLAR, money, shortAddress } from "@/lib/format";
import { MASK, toggleAmountsHidden, useAmountsHidden } from "@/lib/privacy";

/**
 * The top of the wallet: who you are, what you have, and what you can do next.
 *
 * One card rather than three, because a balance means something different
 * depending on whose it is. The handle above the number is what makes it "your
 * money" instead of "a number". Refresh and copy live here too: they are the two
 * things people reach for the moment a balance looks wrong, and hiding them in a
 * menu is how a wallet earns a support message.
 */
export function BalanceCard({
  user,
  balances,
  loading,
  refreshing,
  onRefresh,
  onConvert,
}: {
  user: User;
  balances: Money[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onConvert: () => void;
}) {
  const hidden = useAmountsHidden();
  const dollars = balances.find((balance) => balance.asset === DOLLAR)?.amount ?? "0";
  const hasSomethingToConvert = balances.some((balance) => Number(balance.amount) > 0);

  const profile = user.identities.find((identity) => identity.avatarUrl || identity.displayName);
  const handle = user.handles[0];
  const name = profile?.displayName;

  return (
    <section className="chunk-gold overflow-hidden p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar url={profile?.avatarUrl} fallback={handle?.username ?? name ?? "?"} />
          <div className="min-w-0">
            <p className="eyebrow">Your wallet</p>
            <p className="truncate font-display text-[17px] font-bold tracking-tight">
              {handle ? `@${handle.username}` : (name ?? "Not linked yet")}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <IconButton
            label={hidden ? "Show balance" : "Hide balance"}
            onClick={toggleAmountsHidden}
          >
            {hidden ? (
              <EyeOff size={15} strokeWidth={2.5} />
            ) : (
              <Eye size={15} strokeWidth={2.5} />
            )}
          </IconButton>
          <IconButton label="Refresh balance" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw
              size={15}
              strokeWidth={2.5}
              className={refreshing ? "animate-spin" : undefined}
            />
          </IconButton>
          <CopyAddress address={user.address} />
        </div>
      </div>

      <div className="mt-6">
        {loading ? (
          <span className="block h-[3.25rem] w-52 animate-pulse rounded-xl bg-pen/[0.12]" />
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {/* Space Grotesk draws its dollar sign taller than its digits: the
                stroke pierces above the cap line and below the baseline. At the
                same size it therefore cannot sit flush, however it is aligned.
                So it is scaled to the digits' own height and lifted back onto
                their baseline, which puts its top and bottom on the same two
                lines as the numerals. Muted rather than shrunk further, so the
                digits still lead. It sits outside the masked part, so a hidden
                balance still reads as money. */}
            <span className="font-display text-[2.5rem] font-bold leading-none tracking-tight tabular-nums sm:text-[3.35rem]">
              <span className="inline-block translate-y-[-0.085em] text-[0.82em] opacity-40">$</span>
              {hidden ? MASK : money(dollars)}
            </span>
            <span className="flex items-center gap-1.5 rounded-full border-2 border-pen/20 bg-card-bright/60 py-1 pl-1 pr-2.5">
              <TokenIcon asset={DOLLAR} size={20} />
              <span className="font-display text-[13px] font-bold">{DOLLAR}</span>
            </span>
          </p>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-2.5">
        <Link href="/wallet/send" className="btn btn-dark flex-1 sm:flex-none">
          <Send size={15} strokeWidth={2.4} /> Send
        </Link>
        <Link href="/wallet/receive" className="btn flex-1 sm:flex-none">
          <ArrowDownToLine size={15} strokeWidth={2.4} /> Deposit
        </Link>
        <button onClick={onConvert} disabled={!hasSomethingToConvert} className="btn">
          <Repeat size={15} strokeWidth={2.4} /> Convert
        </button>
      </div>
    </section>
  );
}

/**
 * Everything that is not dollars, with its own logo and its own line.
 *
 * Separate from the balance card on purpose: one number is the answer to "how
 * much do I have", and a list of four assets is the answer to a question nobody
 * asked while they were reading it.
 */
export function AssetList({ balances, loading }: { balances: Money[]; loading: boolean }) {
  const hidden = useAmountsHidden();

  if (loading) {
    return (
      <section className="chunk p-5 sm:p-6">
        <p className="label">Everything you hold</p>
        <div className="mt-4 space-y-2.5">
          {[0, 1].map((row) => (
            <div key={row} className="flex items-center gap-3 rounded-2xl border-2 border-pen/10 p-3">
              <span className="h-8 w-8 animate-pulse rounded-full bg-pen/[0.08]" />
              <span className="h-3.5 w-16 animate-pulse rounded bg-pen/[0.08]" />
              <span className="ml-auto h-3.5 w-20 animate-pulse rounded bg-pen/[0.08]" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  const rows = balances.length > 0 ? balances : [{ asset: DOLLAR, amount: "0" }];

  return (
    <section className="chunk p-5 sm:p-6">
      <p className="label">Everything you hold</p>
      <div className="mt-4 space-y-2.5">
        {rows.map((balance) => (
          <div
            key={balance.asset}
            className="flex items-center gap-3 rounded-2xl border-2 border-pen/12 bg-card-bright/60 p-3"
          >
            <TokenIcon asset={balance.asset} size={32} />
            <span className="font-display text-[15px] font-bold tracking-tight">
              {balance.asset}
            </span>
            <span className="ml-auto font-display text-[15px] font-bold tabular-nums">
              {hidden ? MASK : money(balance.amount)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Avatar({ url, fallback }: { url?: string; fallback: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={44}
        height={44}
        className="h-11 w-11 shrink-0 rounded-full border-2 border-pen/20 object-cover"
      />
    );
  }
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-pen/20 bg-pen/[0.09] font-display text-lg font-bold text-pen/70">
      {fallback.slice(0, 1).toUpperCase()}
    </span>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-full border-2 border-pen/20 bg-card-bright/60 text-pen transition-colors hover:bg-card-bright disabled:opacity-55"
    >
      {children}
    </button>
  );
}

/**
 * The address, copyable.
 *
 * Shown short because nobody reads 56 characters, and copied whole because
 * anything less is money sent nowhere.
 */
function CopyAddress({ address }: { address: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const copy = async () => {
    setBusy(true);
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast("success", "Address copied.");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("error", "Could not copy. Long press the address to copy it by hand.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      disabled={busy}
      title={address}
      className="flex h-9 items-center gap-1.5 rounded-full border-2 border-pen/20 bg-card-bright/60 pl-2.5 pr-3 font-display text-[12px] font-bold text-pen transition-colors hover:bg-card-bright"
    >
      {busy ? (
        <Loader2 size={13} className="animate-spin" />
      ) : copied ? (
        <Check size={13} strokeWidth={2.8} />
      ) : (
        <Copy size={13} strokeWidth={2.5} />
      )}
      <span className="hidden sm:inline">{copied ? "Copied" : shortAddress(address)}</span>
    </button>
  );
}
