"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  Banknote,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Repeat,
  RefreshCw,
  Send,
  Users,
} from "lucide-react";
import { TokenIcon } from "@/components/TokenIcon";
import { Caustics } from "@/components/wallet/Caustics";
import { KeyProof } from "@/components/wallet/KeyProof";
import { useToast } from "@/contexts/ToastContext";
import type { Money, User } from "@/lib/api";
import { NEAR_NETWORK, features, isNear } from "@/lib/chain";
import { DOLLAR, money, moneyLike, shortAddress } from "@/lib/format";
import { MASK, toggleAmountsHidden, useAmountsHidden } from "@/lib/privacy";
import { useCountUp } from "@/lib/useCountUp";

/**
 * The top of the wallet: what you have, and where it lives.
 *
 * The one rich moment in the app: caustic light drifts over this card and
 * nowhere else, so the eye lands on the money first. The account name sits on
 * it because on NEAR the name is the point (it is your handle), and the key
 * proof sits at its foot because "Selkie holds no key" means most next to the
 * number it protects. Refresh and hide are here too: they are what people
 * reach for the moment a balance looks wrong.
 */
export function BalanceCard({
  user,
  balances,
  loading,
  refreshing,
  onRefresh,
}: {
  user: User;
  balances: Money[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const hidden = useAmountsHidden();
  const dollars = balances.find((balance) => balance.asset === DOLLAR)?.amount ?? "0";

  // Counted, not printed. While the balance is still loading this target is 0,
  // so the count begins the moment the real figure arrives rather than starting
  // against a number nobody has seen yet. Off while the balance is covered.
  const counted = useCountUp(Number(dollars) || 0, { enabled: !hidden });
  const shown = moneyLike(counted, dollars);
  const point = shown.indexOf(".");
  const whole = point === -1 ? shown : shown.slice(0, point);
  const cents = point === -1 ? "" : shown.slice(point);

  return (
    <section className="chunk-gold overflow-hidden">
      <Caustics className="pointer-events-none absolute inset-0 h-full w-full opacity-60 mix-blend-screen" />
      <div className="relative flex min-h-[14.75rem] flex-col p-5 sm:px-6 sm:py-[1.375rem]">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1">
            <span className="mr-1.5 text-[14px] text-pen/70">Balance</span>
            <IconButton label={hidden ? "Show balance" : "Hide balance"} onClick={toggleAmountsHidden}>
              {hidden ? <EyeOff size={14} strokeWidth={2.2} /> : <Eye size={14} strokeWidth={2.2} />}
            </IconButton>
            <IconButton label="Refresh balance" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw size={14} strokeWidth={2.2} className={refreshing ? "animate-spin" : undefined} />
            </IconButton>
          </span>
          <CopyAddress address={user.address} />
        </div>

        <div className="mt-3 sm:mt-2">
          {loading ? (
            <span className="skel block h-[3.75rem] w-56 rounded-2xl sm:h-[5rem]" />
          ) : (
            <p className="font-display text-[3.6rem] font-extrabold leading-[0.95] tracking-[-0.05em] tabular-nums sm:text-[5.25rem]">
              <span>$</span>
              {hidden ? (
                MASK
              ) : (
                <>
                  {whole}
                  <small className="text-[0.48em] tracking-[-0.03em] text-pen/45">{cents}</small>
                </>
              )}
            </p>
          )}
          <p className="mt-1.5 font-mono text-[12px] text-pen/45">
            {DOLLAR} on {isNear ? `NEAR ${NEAR_NETWORK}` : "Stellar testnet"}
          </p>
        </div>

        <div className="mt-auto pt-5">{isNear && <KeyProof />}</div>
      </div>
    </section>
  );
}

/**
 * The four things you do with money, under the number. Send is the one
 * filled in: it is why people open the app.
 */
export function BalanceActions({
  balances,
  onConvert,
}: {
  balances: Money[];
  /** Absent where the chain has no conversion; the button goes with it. */
  onConvert?: () => void;
}) {
  const hasSomethingToConvert = balances.some((balance) => Number(balance.amount) > 0);
  const base =
    "flex h-[3.625rem] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl text-[13px] font-semibold transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.98] sm:flex-row sm:gap-2.5 sm:text-[14.5px]";
  const plain = `${base} bg-tide-1 text-pen shadow-[inset_0_0_0_1px_rgba(233,241,236,0.08)] hover:bg-tide-2`;
  return (
    <div className="grid grid-cols-4 gap-2 sm:gap-2.5">
      <Link href="/wallet/send" className={`${base} bg-sg text-abyss hover:bg-sg-light`}>
        <Send size={17} strokeWidth={2} /> Send
      </Link>
      <Link href="/wallet/receive" className={plain}>
        <ArrowDownToLine size={17} strokeWidth={2} className="text-pen/70" /> Deposit
      </Link>
      {features.cashOut && (
        <Link href="/wallet/cashout" className={plain}>
          <Banknote size={17} strokeWidth={2} className="text-pen/70" /> Cash out
        </Link>
      )}
      {features.convert && onConvert ? (
        <button onClick={onConvert} disabled={!hasSomethingToConvert} className={`${plain} disabled:opacity-50`}>
          <Repeat size={17} strokeWidth={2} className="text-pen/70" /> Convert
        </button>
      ) : (
        features.payMany && (
          <Link href="/wallet/many" className={plain}>
            <Users size={17} strokeWidth={2} className="text-pen/70" /> Pay many
          </Link>
        )
      )}
    </div>
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
            <div key={row} className="flex items-center gap-3 rounded-2xl bg-pen/[0.03] p-3">
              <span className="skel h-8 w-8 rounded-full" />
              <span className="skel h-3.5 w-16 rounded" />
              <span className="skel ml-auto h-3.5 w-20 rounded" />
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
            className="flex items-center gap-3 rounded-2xl bg-pen/[0.03] p-3"
          >
            <TokenIcon asset={balance.asset} size={32} />
            <span className="font-display text-[15px] font-bold tracking-tight">
              {balance.asset}
            </span>
            <span className="ml-auto font-mono text-[14.5px] tabular-nums">
              {hidden ? MASK : money(balance.amount)}
            </span>
          </div>
        ))}
      </div>
    </section>
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
      className="grid h-8 w-8 place-items-center rounded-full text-pen/55 transition-colors duration-150 hover:bg-pen/[0.08] hover:text-pen disabled:opacity-50"
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
      toast("success", isNear ? "Account name copied." : "Address copied.");
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
      title={`Copy ${address}`}
      aria-label={isNear ? "Copy account name" : "Copy address"}
      className="inline-flex min-w-0 items-center gap-2 rounded-full bg-abyss/45 px-3 py-[0.45rem] font-mono text-[12px] text-pen shadow-[inset_0_0_0_1px_rgba(233,241,236,0.14)] transition-colors duration-150 hover:bg-abyss/70"
    >
      {/* On NEAR the name is the handle, so it is shown whole (truncated only
          when the screen is too narrow); elsewhere a short form is enough. */}
      <span className="min-w-0 truncate">{copied ? "Copied" : isNear ? address : shortAddress(address)}</span>
      {busy ? (
        <Loader2 size={13} className="shrink-0 animate-spin" />
      ) : copied ? (
        <Check size={13} strokeWidth={2.6} className="shrink-0 text-sg" />
      ) : (
        <Copy size={13} strokeWidth={2.2} className="shrink-0 text-pen/60" />
      )}
    </button>
  );
}
