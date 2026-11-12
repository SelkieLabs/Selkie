"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, ChevronDown, Eye, Globe, Loader2, RotateCcw } from "lucide-react";
import { ChainLogo, CoinOnChain } from "@/components/ChainLogo";
import { AddressCode, CopyButton } from "@/components/wallet/AddressBits";
import { useConfirm } from "@/contexts/useConfirm";
import { ApiError, api, type ChainAsset, type IntentsQuote } from "@/lib/api";
import { cleanAmount } from "@/lib/format";
import { addressPlaceholder, assetName, chainAddressProblem, inAbout, useChainAssets } from "@/lib/other-chain";
import { Head, Note, Row, Surface } from "./cashout/bits";
import { IntentsTimeline } from "./cashout/IntentsTimeline";

/**
 * Other chains, through NEAR Intents (1Click).
 *
 * Money in: pick the coin you have (USDT on Tron, say), get an address, send
 * to it from your own wallet there. NEAR Intents swaps it and the USDC lands in
 * your NEAR account. Selkie never touches it on the way.
 *
 * Money out lives in CashOutPanel (and components/wallet/cashout) and uses the
 * pieces here: the coin picker and the preview label.
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
        className="co-field co-trigger flex items-center gap-3 text-left"
      >
        {picked && <CoinOnChain symbol={picked.symbol} blockchain={picked.blockchain} chainName={picked.chainName} size={26} />}
        <span className="min-w-0 truncate">{picked ? assetName(picked) : "Pick a coin"}</span>
      </button>
      <ChevronDown
        size={17}
        strokeWidth={2.2}
        className={`pointer-events-none absolute right-4 top-[25px] -translate-y-1/2 text-[rgba(233,241,236,.5)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      />
      {open && (
        <ul role="listbox" aria-labelledby={id} className="co-menu">
          {assets.map((asset) => {
            const selected = asset.assetId === value;
            return (
              <li key={asset.assetId} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(asset);
                    setOpen(false);
                  }}
                  className="co-option"
                >
                  <CoinOnChain symbol={asset.symbol} blockchain={asset.blockchain} chainName={asset.chainName} size={28} />
                  <span className="min-w-0 flex-1">
                    {asset.symbol} <em>on {asset.chainName}</em>
                  </span>
                  {selected && <Check size={16} strokeWidth={2.6} className="shrink-0 text-[#7fd1b9]" />}
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
    <div className="mt-4">
      <Note tone="info" icon={<Eye size={15} />}>
        <b>Preview only.</b> This is a live price from NEAR Intents. NEAR Intents runs on NEAR mainnet and this is the
        testnet version of Selkie, so {what}
      </Note>
    </div>
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
    <Row label={label} icon={icon}>
      {strong ? <b className="font-semibold">{value}</b> : value}
    </Row>
  );
}

/** Where a move between chains has got to. Kept under its old name for anything that still calls it. */
export function IntentsProgress({
  depositAddress,
  direction,
  chainName,
  symbol = "USDC",
}: {
  depositAddress: string;
  direction: "in" | "out";
  chainName: string;
  symbol?: string;
}) {
  return <IntentsTimeline depositAddress={depositAddress} direction={direction} asset={{ symbol, chainName }} />;
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
    <Surface label="Add money from another chain">
      <Head
        kicker="From another chain"
        title="Add money from another chain"
        blurb="Have USDC on Base or USDT on Tron? Send it here through NEAR Intents and it arrives as USDC in your account. You pay from your own wallet there; Selkie never holds it on the way."
      />

      {chains.error ? (
        <div className="mt-6 grid justify-items-start gap-3">
          <p className="co-error">{chains.error}</p>
          <button type="button" onClick={() => void chains.reload()} className="co-ghost" style={{ width: "auto" }}>
            Try again
          </button>
        </div>
      ) : !chains.assets || !picked ? (
        <p className="co-hint mt-6 inline-flex items-center gap-2">
          <Loader2 size={15} className="co-spin" /> Asking NEAR Intents which chains are open
        </p>
      ) : quote?.depositAddress ? (
        <DepositAddress quote={quote} onDone={() => setQuote(null)} />
      ) : (
        <>
          <label className="co-label mt-6" htmlFor="in-asset">
            What you are sending
          </label>
          <AssetSelect id="in-asset" assets={chains.assets} value={picked.assetId} onChange={changed(setAsset)} />

          <label className="co-label mt-5" htmlFor="in-amount">
            How much
          </label>
          <input
            id="in-amount"
            className="co-field co-num mt-2"
            placeholder="0.00"
            inputMode="decimal"
            value={amount}
            onChange={(e) => changed(setAmount)(cleanAmount(e.target.value))}
          />

          <label className="co-label mt-5" htmlFor="in-refund">
            <ChainLogo blockchain={picked.blockchain} name={picked.chainName} size={16} />
            Your address on {picked.chainName}, in case it has to come back
          </label>
          <input
            id="in-refund"
            className="co-field co-mono mt-2"
            placeholder={addressPlaceholder(picked)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={Boolean(refundProblem) || undefined}
            value={refund}
            onChange={(e) => changed(setRefund)(e.target.value)}
          />
          {refundProblem && <p className="co-error mt-2">{refundProblem}</p>}

          {quote && (
            <div className="co-receipt mt-6">
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
          {error && <p className="co-error mt-4">{error}</p>}

          {quote && !quote.preview ? (
            <button
              type="button"
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
              className="co-btn mt-6"
            >
              {busy === "address" ? <Loader2 size={16} className="co-spin" /> : null}
              I&apos;m ready to send: show the address
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void ask(false)}
              disabled={!ready || busy !== null || Boolean(quote)}
              className="co-btn mt-6"
            >
              {busy === "price" ? (
                <>
                  <Loader2 size={16} className="co-spin" /> Getting a price
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
    </Surface>
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
          <p className="co-label">
            <CoinOnChain symbol={quote.asset.symbol} blockchain={quote.asset.blockchain} chainName={quote.asset.chainName} size={22} />
            <span>
              Send exactly {quote.amountInFormatted} {quote.asset.symbol} on {quote.asset.chainName} to
            </span>
          </p>
          <p className="co-field co-mono co-box mt-2 break-all">{address}</p>
          <CopyButton value={address} label="the deposit address" className="co-ghost mt-3" />
        </div>
      </div>

      <div className="mt-5">
        <Note tone="warn" icon={<AlertTriangle size={15} />}>
          Only {quote.asset.symbol}, only on {quote.asset.chainName}, and only once.
          {until ? ` Send it before ${until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : ""} If
          anything is off, NEAR Intents sends it back to your refund address.
        </Note>
      </div>

      <div className="co-receipt mt-5 p-5">
        <IntentsTimeline depositAddress={address} direction="in" asset={quote.asset} />
      </div>

      <button type="button" onClick={onDone} className="co-ghost mt-5">
        <RotateCcw size={15} /> Start another
      </button>
    </>
  );
}
