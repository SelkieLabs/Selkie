"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  Eye,
  Globe,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { ChainLogo, CoinOnChain } from "@/components/ChainLogo";
import { AddressCode, CopyButton } from "@/components/wallet/AddressBits";
import { Panel, PanelHead } from "@/components/wallet/Panel";
import { useConfirm } from "@/contexts/useConfirm";
import { ApiError, api, type ChainAsset, type IntentsQuote, type IntentsStatus } from "@/lib/api";
import { cleanAmount } from "@/lib/format";
import { addressPlaceholder, assetName, chainAddressProblem, inAbout, useChainAssets } from "@/lib/other-chain";

/**
 * Other chains, through NEAR Intents (1Click).
 *
 * Money in: pick the coin you have (USDT on Tron, say), get an address, send
 * to it from your own wallet there. NEAR Intents swaps it and the USDC lands in
 * your NEAR account. Selkie never touches it on the way.
 *
 * Money out lives in CashOutPanel and uses the pieces here: the coin picker,
 * the address check, the preview label, and the live status.
 *
 * NEAR Intents runs on mainnet only. On testnet every price here is real but
 * is a preview, and it says so where the person is looking.
 */

/**
 * Which coin, on which chain. A picker rather than a <select>, because a
 * native option cannot show a logo, and people find "USDT on Tron" by its marks
 * faster than by reading sixteen lines.
 */
export function AssetSelect({
  id,
  assets,
  value,
  onChange,
}: {
  id: string;
  assets: ChainAsset[];
  value: string;
  onChange: (asset: ChainAsset) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const picked = assets.find((asset) => asset.assetId === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={box} className="relative mt-2">
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="field flex items-center gap-3 pr-11 text-left text-[15px] font-semibold"
      >
        {picked && <CoinOnChain symbol={picked.symbol} blockchain={picked.blockchain} chainName={picked.chainName} size={26} />}
        <span className="min-w-0 truncate">{picked ? assetName(picked) : "Pick a coin"}</span>
      </button>
      <ChevronDown
        size={17}
        strokeWidth={2.4}
        className={`pointer-events-none absolute right-4 top-6 -translate-y-1/2 text-pen/45 transition-transform ${open ? "rotate-180" : ""}`}
      />
      {open && (
        <ul
          role="listbox"
          aria-labelledby={id}
          className="absolute inset-x-0 z-30 mt-2 max-h-80 overflow-y-auto rounded-2xl border-2 border-pen bg-card-bright p-1.5 shadow-[0.18rem_0.24rem_0_rgba(3,9,15,0.55)]"
        >
          {assets.map((asset) => {
            const selected = asset.assetId === value;
            return (
              <li key={asset.assetId} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(asset);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-semibold transition-colors hover:bg-pen/[0.06] ${
                    selected ? "bg-gold/15" : ""
                  }`}
                >
                  <CoinOnChain symbol={asset.symbol} blockchain={asset.blockchain} chainName={asset.chainName} size={28} />
                  <span className="min-w-0 flex-1">
                    {asset.symbol} <span className="font-medium text-pen/55">on {asset.chainName}</span>
                  </span>
                  {selected && <Check size={16} strokeWidth={2.6} className="shrink-0 text-gold-ink" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Said wherever a testnet price is shown, so nobody takes it for a payment. */
export function PreviewNote({ what }: { what: string }) {
  return (
    <p className="mt-4 flex items-start gap-2.5 rounded-xl bg-gold/15 p-3.5 text-[14px] leading-relaxed text-pen/75">
      <Eye size={16} className="mt-0.5 shrink-0 text-gold-ink" />
      <span>
        <b>Preview only.</b> This is a live price from NEAR Intents. NEAR Intents runs on NEAR mainnet and
        this is the testnet version of Selkie, so {what}
      </span>
    </p>
  );
}

/** One line of a price: a label on the left, the number on the right. */
export function QuoteRow({
  label,
  value,
  strong,
  icon,
}: {
  label: string;
  value: string;
  strong?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-t-2 border-pen/[0.08] px-4 py-3.5 first:border-t-0">
      <span className="shrink-0 text-[14px] font-semibold text-pen/55">{label}</span>
      <span
        className={`flex min-w-0 items-center justify-end gap-2 break-all text-right text-[14px] font-bold ${strong ? "text-pen" : "text-pen/85"}`}
      >
        {icon}
        {value}
      </span>
    </div>
  );
}

type Direction = "in" | "out";

/** Each status in words, from the side of the person watching it. */
function statusWords(status: IntentsStatus, direction: Direction, chainName: string): string {
  switch (status.status) {
    case "PENDING_DEPOSIT":
      return direction === "in"
        ? `Waiting for your deposit. Send it from your wallet on ${chainName}.`
        : "Your USDC left Selkie. Waiting for NEAR Intents to pick it up.";
    case "KNOWN_DEPOSIT_TX":
      return "Deposit seen. Waiting for it to confirm.";
    case "PROCESSING":
      return direction === "in" ? "Swapping it into USDC on NEAR." : `Swapping it and sending it to ${chainName}.`;
    case "SUCCESS":
      return direction === "in"
        ? `Done. ${status.amountOutFormatted ?? "It"} USDC is in your account.`
        : `Done. It arrived on ${chainName}.`;
    case "INCOMPLETE_DEPOSIT":
      return "Less arrived than the price was for, so NEAR Intents is sending it back.";
    case "REFUNDED":
      return direction === "in"
        ? "It was sent back to your refund address."
        : "It came back to your Selkie account. Nothing was lost.";
    case "FAILED":
      return `It did not go through.${status.refundReason ? ` ${status.refundReason}` : ""}`;
  }
}

/**
 * Where a move between chains has got to, read from NEAR Intents every few
 * seconds until it is finished one way or the other.
 */
export function IntentsProgress({
  depositAddress,
  direction,
  chainName,
}: {
  depositAddress: string;
  direction: Direction;
  chainName: string;
}) {
  const [status, setStatus] = useState<IntentsStatus | null>(null);
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await api.near.intents.status(depositAddress);
        if (!alive) return;
        setStatus(next);
        setProblem(false);
        if (next.done) return;
      } catch {
        if (!alive) return;
        setProblem(true);
      }
      timer = setTimeout(() => void tick(), 6_000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [depositAddress]);

  const good = status?.status === "SUCCESS";
  const bad = status?.done && !good;
  const links = [...(status?.originTxs ?? []), ...(status?.destinationTxs ?? [])];

  return (
    <div className="mt-5 w-full rounded-2xl border-2 border-pen/15 bg-card-bright p-4 text-left">
      <div className="flex items-start gap-3">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 ${
            good
              ? "border-[#2f7d3f]/40 bg-[#2f7d3f]/12 text-[#2f7d3f]"
              : bad
                ? "border-[#a11d34]/30 bg-[#a11d34]/10 text-[#a11d34]"
                : "border-gold bg-gold/15 text-gold-ink"
          }`}
        >
          {good ? (
            <Check size={17} strokeWidth={2.8} />
          ) : bad ? (
            status?.status === "REFUNDED" ? <RotateCcw size={16} strokeWidth={2.6} /> : <X size={17} strokeWidth={2.8} />
          ) : (
            <Loader2 size={17} className="animate-spin" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">NEAR Intents</p>
          <p className="mt-1 text-[15px] font-semibold leading-relaxed text-pen/85">
            {status ? statusWords(status, direction, chainName) : "Checking where it has got to."}
          </p>
          {problem && <p className="mt-1 text-[13px] text-pen/55">Could not check just now. Trying again.</p>}
          {links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {links.map((url, index) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[13px] font-bold text-pen/55 transition-colors hover:text-pen"
                >
                  {index < (status?.originTxs.length ?? 0) ? "Deposit" : "Arrival"} <ExternalLink size={12} />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Add money from another chain. Receive shows it under the account name.
 *
 * Two steps on purpose: a price first, and the deposit address only when the
 * person says they are ready, because the address is good for about ten
 * minutes and a stale one is a trap.
 */
export function AddFromChain() {
  const chains = useChainAssets();
  const confirm = useConfirm();
  const [asset, setAsset] = useState<ChainAsset | null>(null);
  const [amount, setAmount] = useState("");
  const [refund, setRefund] = useState("");
  const [quote, setQuote] = useState<IntentsQuote | null>(null);
  const [busy, setBusy] = useState<"price" | "address" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const picked = asset ?? chains.assets?.[0] ?? null;
  const refundProblem = picked ? chainAddressProblem(picked, refund) : null;
  const ready = picked !== null && Number(amount) > 0 && refund.trim().length > 0 && !refundProblem;

  /** Any change makes the price on screen wrong, so it goes. */
  const changed = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setQuote(null);
    setError(null);
  };

  const ask = async (commit: boolean) => {
    if (!picked) return;
    setBusy(commit ? "address" : "price");
    setError(null);
    try {
      setQuote(
        await api.near.intents.quote({ direction: "in", assetId: picked.assetId, amount, address: refund.trim(), commit }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not get a price just now. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel>
      <PanelHead
        eyebrow="From another chain"
        title="Add money from another chain"
        blurb="Have USDC on Base or USDT on Tron? Send it here through NEAR Intents and it arrives as USDC in your account. You pay from your own wallet there; Selkie never holds it on the way."
      />

      {chains.error ? (
        <div className="mt-6 rounded-2xl border-2 border-pen/15 bg-pen/[0.04] p-5 text-center">
          <p className="text-[15px] font-semibold text-[#a11d34]">{chains.error}</p>
          <button onClick={() => void chains.reload()} className="btn btn-dim btn-sm mx-auto mt-4">
            Try again
          </button>
        </div>
      ) : !chains.assets || !picked ? (
        <div className="mt-6 flex items-center gap-3 text-[14px] font-semibold text-pen/55">
          <Loader2 size={18} className="animate-spin" /> Asking NEAR Intents which chains are open
        </div>
      ) : quote?.depositAddress ? (
        <DepositAddress quote={quote} onDone={() => setQuote(null)} />
      ) : (
        <>
          <label className="label mt-6 block" htmlFor="in-asset">
            What you are sending
          </label>
          <AssetSelect id="in-asset" assets={chains.assets} value={picked.assetId} onChange={changed(setAsset)} />

          <label className="label mt-5 block" htmlFor="in-amount">
            How much
          </label>
          <input
            id="in-amount"
            className="field mt-2 font-display text-xl font-bold"
            placeholder="0.00"
            inputMode="decimal"
            value={amount}
            onChange={(e) => changed(setAmount)(cleanAmount(e.target.value))}
          />

          <label className="label mt-5 flex items-center gap-2" htmlFor="in-refund">
            <ChainLogo blockchain={picked.blockchain} name={picked.chainName} size={18} />
            Your address on {picked.chainName}, in case it has to come back
          </label>
          <input
            id="in-refund"
            className="field mt-2 font-mono text-[13px]"
            placeholder={addressPlaceholder(picked)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={refund}
            onChange={(e) => changed(setRefund)(e.target.value)}
          />
          {refundProblem && <p className="mt-2 text-sm font-semibold text-[#a11d34]">{refundProblem}</p>}

          {quote && (
            <div className="mt-6 overflow-hidden rounded-2xl border-2 border-pen/15 bg-card-bright">
              <QuoteRow
                label="You send"
                value={`${quote.amountInFormatted} ${quote.asset.symbol} on ${quote.asset.chainName}`}
                icon={<CoinOnChain symbol={quote.asset.symbol} blockchain={quote.asset.blockchain} chainName={quote.asset.chainName} size={20} />}
              />
              <QuoteRow
                label="You get about"
                value={`${quote.amountOutFormatted} USDC`}
                strong
                icon={<CoinOnChain symbol="USDC" blockchain="near" chainName="NEAR" size={20} />}
              />
              {quote.minAmountOutFormatted && <QuoteRow label="At least" value={`${quote.minAmountOutFormatted} USDC`} />}
              <QuoteRow label="Takes" value={inAbout(quote.timeEstimate)} />
            </div>
          )}

          {quote?.preview && <PreviewNote what="it will not give you an address to send to." />}
          {error && <p className="mt-4 text-sm font-semibold text-[#a11d34]">{error}</p>}

          {quote && !quote.preview ? (
            <button
              onClick={async () => {
                const yes = await confirm({
                  title: `Only send ${quote.asset.symbol} on ${quote.asset.chainName}`,
                  confirm: "Show the address",
                  rows: [
                    { label: "Send", value: `${quote.amountInFormatted} ${quote.asset.symbol}` },
                    { label: "From", value: quote.asset.chainName },
                    { label: "You get about", value: `${quote.amountOutFormatted} USDC` },
                  ],
                  body: "The address is good for about 10 minutes. Another coin or another chain sent to it can be lost.",
                  note: "If the swap can't finish, NEAR Intents sends it back to your refund address.",
                });
                if (yes) void ask(true);
              }}
              disabled={busy !== null}
              className="btn btn-gold mt-6 w-full"
            >
              {busy === "address" ? <Loader2 size={16} className="animate-spin" /> : null}
              I&apos;m ready to send: show the address
            </button>
          ) : (
            <button
              onClick={() => void ask(false)}
              disabled={!ready || busy !== null || Boolean(quote)}
              className="btn btn-gold mt-6 w-full"
            >
              {busy === "price" ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Getting a price
                </>
              ) : quote?.preview ? (
                <>
                  <Globe size={16} /> Sending in works on mainnet
                </>
              ) : (
                <>
                  See the price <ArrowRight size={16} strokeWidth={2.4} />
                </>
              )}
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

/** Mainnet, money in: the address to send to, how long it is good for, and how it is going. */
function DepositAddress({ quote, onDone }: { quote: IntentsQuote & { depositAddress?: string }; onDone: () => void }) {
  const address = quote.depositAddress!;
  const until = quote.deadline ? new Date(quote.deadline) : null;
  return (
    <>
      <div className="mt-6 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <AddressCode address={address} alt={`The ${quote.asset.chainName} deposit address as a scannable code`} />
        <div className="min-w-0 flex-1">
          <p className="label flex items-center gap-2">
            <CoinOnChain symbol={quote.asset.symbol} blockchain={quote.asset.blockchain} chainName={quote.asset.chainName} size={22} />
            <span>
              Send exactly {quote.amountInFormatted} {quote.asset.symbol} on {quote.asset.chainName} to
            </span>
          </p>
          <p className="mt-2 break-all rounded-xl border-2 border-pen/15 bg-card-bright p-3 font-mono text-[13px] font-medium leading-relaxed text-pen/85">
            {address}
          </p>
          <CopyButton value={address} label="the deposit address" className="btn btn-dark btn-sm mt-3 w-full" />
        </div>
      </div>

      <p className="mt-5 flex items-start gap-2.5 rounded-xl bg-[#a11d34]/[0.07] p-3.5 text-[14px] leading-relaxed text-pen/75">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#a11d34]" />
        <span>
          Only {quote.asset.symbol}, only on {quote.asset.chainName}, and only once.
          {until ? ` Send it before ${until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : ""} If
          anything is off, NEAR Intents sends it back to your refund address.
        </span>
      </p>

      <IntentsProgress depositAddress={address} direction="in" chainName={quote.asset.chainName} />

      <button onClick={onDone} className="btn btn-dim mt-5 w-full">
        <Clock size={15} /> Start another
      </button>
    </>
  );
}
