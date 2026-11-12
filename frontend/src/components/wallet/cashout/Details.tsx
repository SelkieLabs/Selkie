"use client";

import { AlertTriangle, ArrowRight, Check, ChevronDown, Eye, Loader2 } from "lucide-react";
import { ChainLogo, CoinOnChain } from "@/components/ChainLogo";
import { AssetSelect } from "@/components/wallet/OtherChain";
import { ADDRESS } from "@/lib/address";
import type { AccountLookup, ChainAsset } from "@/lib/api";
import { isNear } from "@/lib/chain";
import { addressPlaceholder, inAbout, type useOutQuote } from "@/lib/other-chain";
import { PaycrestBankFields } from "./BankFields";
import { Fresh, Head, Note, Row } from "./bits";
import { COUNTRIES, type BankDetails, type Destination } from "./model";

type OutQuote = ReturnType<typeof useOutQuote>;

/** What the live account lookup has found for the name in the box. */
export interface Lookup {
  checking: boolean;
  /** The name the result below belongs to. */
  forAddress: string | null;
  problem: string | null;
  found: AccountLookup | null;
}

const TITLE: Record<Destination, string> = {
  bank: "Which bank account?",
  wallet: isNear ? "Which NEAR account?" : "Which wallet?",
  chain: "Which chain, and which address?",
};

export function DetailsStep({
  destination,
  bank,
  onBank,
  address,
  onAddress,
  cleanAddress,
  addressValid,
  lookup,
  chains,
  asset,
  onAsset,
  chainAddress,
  onChainAddress,
  chainProblem,
  quote,
  paycrest,
  error,
  ready,
  busy,
  onContinue,
}: {
  destination: Destination;
  bank: BankDetails;
  onBank: (patch: Partial<BankDetails>) => void;
  address: string;
  onAddress: (value: string) => void;
  cleanAddress: string;
  addressValid: boolean;
  lookup: Lookup;
  chains: { assets: ChainAsset[] | null; error: string | null; reload: () => void };
  asset: ChainAsset | null;
  onAsset: (asset: ChainAsset) => void;
  chainAddress: string;
  onChainAddress: (value: string) => void;
  chainProblem: string | null;
  quote: OutQuote;
  /** NEAR: Paycrest's banks, the name check and the rate. Without it, the bank form is Stellar's. */
  paycrest?: Omit<Parameters<typeof PaycrestBankFields>[0], "bank" | "onBank">;
  error: string | null;
  ready: boolean;
  /** Set while the continue button waits: what it is waiting for. */
  busy: string | null;
  onContinue: () => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !busy) onContinue();
      }}
    >
      <Head
        title={TITLE[destination]}
        blurb={
          destination === "bank"
            ? paycrest
              ? "Pick the currency and your bank. The name on the account shows as you type the number."
              : "We only ask for this once. Next time it is two taps."
            : destination === "chain"
              ? "Pick what it should arrive as, then paste your address there."
              : "Money sent to another account cannot be called back, so this is worth reading twice."
        }
      />

      <div className="mt-6">
        {destination === "bank" && paycrest ? (
          <PaycrestBankFields bank={bank} onBank={onBank} {...paycrest} />
        ) : destination === "bank" ? (
          <BankFields bank={bank} onBank={onBank} />
        ) : destination === "chain" ? (
          <ChainFields
            chains={chains}
            asset={asset}
            onAsset={onAsset}
            address={chainAddress}
            onAddress={onChainAddress}
            problem={chainProblem}
            quote={quote}
          />
        ) : (
          <WalletFields address={address} onAddress={onAddress} cleanAddress={cleanAddress} valid={addressValid} lookup={lookup} />
        )}
      </div>

      {error && (
        <p className="co-error mt-4" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="co-btn mt-6" disabled={!ready || busy !== null}>
        {busy ? (
          <>
            <Loader2 size={16} className="co-spin" /> {busy}
          </>
        ) : (
          <>
            Review <ArrowRight size={16} strokeWidth={2.4} />
          </>
        )}
      </button>
    </form>
  );
}

function BankFields({ bank, onBank }: { bank: BankDetails; onBank: (patch: Partial<BankDetails>) => void }) {
  return (
    <div className="grid gap-2.5">
      <label className="co-label" htmlFor="cashout-country">
        Country
      </label>
      <div className="relative">
        <select
          id="cashout-country"
          className="co-field"
          value={bank.country}
          onChange={(e) => onBank({ country: e.target.value })}
        >
          {COUNTRIES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={17}
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[rgba(233,241,236,.5)]"
        />
      </div>
      <label className="co-label mt-2" htmlFor="cashout-bank">
        Bank
      </label>
      <input
        id="cashout-bank"
        className="co-field"
        placeholder="Bank name"
        autoCapitalize="words"
        value={bank.bank}
        onChange={(e) => onBank({ bank: e.target.value })}
      />
      <input
        aria-label="Account number"
        className="co-field"
        placeholder="Account number"
        inputMode="numeric"
        autoCorrect="off"
        value={bank.accountNumber}
        onChange={(e) => onBank({ accountNumber: e.target.value.replace(/[^0-9]/g, "") })}
      />
      <input
        aria-label="Name on the account"
        className="co-field"
        placeholder="Name on the account"
        autoCapitalize="words"
        value={bank.accountName}
        onChange={(e) => onBank({ accountName: e.target.value })}
      />
      <p className="co-hint mt-1">The name has to match the account, or the bank sends it straight back.</p>
    </div>
  );
}

function WalletFields({
  address,
  onAddress,
  cleanAddress,
  valid,
  lookup,
}: {
  address: string;
  onAddress: (value: string) => void;
  cleanAddress: string;
  valid: boolean;
  lookup: Lookup;
}) {
  const shapeWrong = cleanAddress.length > 0 && !valid;
  const result = lookup.forAddress === cleanAddress ? lookup : null;

  return (
    <>
      <label className="co-label" htmlFor="cashout-address">
        {ADDRESS.label}
      </label>
      <textarea
        id="cashout-address"
        rows={isNear ? 1 : 2}
        className="co-field co-mono mt-2 break-all"
        placeholder={ADDRESS.placeholder}
        autoCapitalize={ADDRESS.capitalize}
        autoCorrect="off"
        spellCheck={false}
        autoFocus
        aria-invalid={shapeWrong || Boolean(result?.problem) || undefined}
        value={address}
        onChange={(e) => onAddress(e.target.value.replace(/\n/g, ""))}
      />

      <p className="mt-2 min-h-[1.5rem]" aria-live="polite">
        {shapeWrong ? (
          <span className="co-error">{ADDRESS.invalid}</span>
        ) : lookup.checking && valid ? (
          <span className="co-hint inline-flex items-center gap-2">
            <Loader2 size={13} className="co-spin" /> Looking the account up
          </span>
        ) : result?.problem ? (
          <span className="co-error">{result.problem}</span>
        ) : result?.found?.kind === "contract" ? (
          <span className="co-hint">This account runs a contract. You will be asked to confirm on the next screen.</span>
        ) : result?.found ? (
          <span className="co-ok inline-flex items-center gap-1.5">
            <Check size={14} strokeWidth={2.8} /> Found. {result.found.onSelkie ? "Someone on Selkie." : "A NEAR account."}
          </span>
        ) : null}
      </p>

      <div className="mt-3">
        <Note tone="warn" icon={<AlertTriangle size={15} />}>
          {isNear
            ? "Only send to an account you own, and check every character. For an exchange, use the NEAR deposit account it shows you and make sure it takes USDC on NEAR. Money sent to the wrong account cannot be recovered by anyone."
            : "Only send to a wallet you own, and check every character. Money sent to the wrong address cannot be recovered by anyone."}
        </Note>
      </div>
    </>
  );
}

function ChainFields({
  chains,
  asset,
  onAsset,
  address,
  onAddress,
  problem,
  quote,
}: {
  chains: { assets: ChainAsset[] | null; error: string | null; reload: () => void };
  asset: ChainAsset | null;
  onAsset: (asset: ChainAsset) => void;
  address: string;
  onAddress: (value: string) => void;
  problem: string | null;
  quote: OutQuote;
}) {
  if (chains.error) {
    return (
      <div className="grid justify-items-start gap-3">
        <p className="co-error">{chains.error}</p>
        <button type="button" className="co-ghost" style={{ width: "auto" }} onClick={() => void chains.reload()}>
          Try again
        </button>
      </div>
    );
  }
  if (!chains.assets || !asset) {
    return (
      <p className="co-hint inline-flex items-center gap-2">
        <Loader2 size={15} className="co-spin" /> Asking NEAR Intents which chains are open
      </p>
    );
  }

  return (
    <>
      <label className="co-label" htmlFor="cashout-asset">
        What it arrives as
      </label>
      <AssetSelect id="cashout-asset" assets={chains.assets} value={asset.assetId} onChange={onAsset} />

      <label className="co-label mt-5" htmlFor="cashout-chain-address">
        <ChainLogo blockchain={asset.blockchain} name={asset.chainName} size={16} />
        Your address on {asset.chainName}
      </label>
      <textarea
        id="cashout-chain-address"
        rows={2}
        className="co-field co-mono mt-2 break-all"
        placeholder={addressPlaceholder(asset)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={Boolean(problem) || undefined}
        value={address}
        onChange={(e) => onAddress(e.target.value.replace(/\n/g, ""))}
      />
      {problem && <p className="co-error mt-2">{problem}</p>}

      <div className="mt-5">
        <QuoteCard asset={asset} quote={quote} />
      </div>

      <div className="mt-4">
        <Note tone="warn" icon={<AlertTriangle size={15} />}>
          Only an address you own on {asset.chainName} that takes {asset.symbol}, and check every character. If the
          swap fails, the USDC comes back to your Selkie account; sent to the wrong address, nobody can recover it.
        </Note>
      </div>
    </>
  );
}

/** The live price, right under the inputs it depends on. */
function QuoteCard({ asset, quote }: { asset: ChainAsset; quote: OutQuote }) {
  if (!quote.ready) {
    return (
      <div className="co-receipt">
        <Row label="They get" muted>
          Paste your address to see the price
        </Row>
      </div>
    );
  }
  if (quote.error && !quote.quote) {
    return (
      <div className="co-receipt p-4">
        <p className="co-error">{quote.error}</p>
        <button type="button" className="co-link mt-2" onClick={quote.retry}>
          Ask again
        </button>
      </div>
    );
  }
  if (!quote.quote) {
    return (
      <div className="co-receipt">
        <Row label="They get" muted>
          <span className="inline-flex items-center gap-2">
            <Loader2 size={13} className="co-spin" /> Asking NEAR Intents for a price
          </span>
        </Row>
      </div>
    );
  }
  const q = quote.quote;
  return (
    <div className="co-receipt">
      <Row
        label="They get about"
        icon={<CoinOnChain symbol={asset.symbol} blockchain={asset.blockchain} chainName={asset.chainName} size={20} />}
      >
        <b className="font-semibold">
          {q.amountOutFormatted} {asset.symbol}
        </b>
      </Row>
      {q.minAmountOutFormatted && (
        <Row label="At least">
          {q.minAmountOutFormatted} {asset.symbol}
        </Row>
      )}
      <Row label="Takes">{inAbout(q.timeEstimate)}</Row>
      <Row label="Fees">In the price. Selkie pays the network fee.</Row>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[rgba(233,241,236,.06)] px-4 py-3">
        <Fresh at={quote.at} every={30} loading={quote.loading} />
        {q.preview && (
          <span className="co-hint inline-flex items-center gap-1.5">
            <Eye size={13} /> Preview: sending works on mainnet
          </span>
        )}
      </div>
    </div>
  );
}
