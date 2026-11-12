"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  Loader2,
  Sparkles,
  Wallet,
} from "lucide-react";
import { ChainLogo, ChainStack, CoinOnChain } from "@/components/ChainLogo";
import { ContractWarning } from "@/components/wallet/ContractWarning";
import { AssetSelect, IntentsProgress, PreviewNote } from "@/components/wallet/OtherChain";
import { Panel, PanelHead } from "@/components/wallet/Panel";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/useConfirm";
import { ADDRESS } from "@/lib/address";
import { ApiError, api, type ChainAsset, type IntentsQuote, type SendResult } from "@/lib/api";
import { NEAR_NETWORK, isNear } from "@/lib/chain";
import { cleanAmount, money, usd } from "@/lib/format";
import {
  addressPlaceholder,
  assetName,
  chainAddressProblem,
  inAbout,
  shortChainAddress,
  useChainAssets,
} from "@/lib/other-chain";
import { useAccountCheck } from "@/lib/near-account";
import { useNearPay } from "@/lib/near-wallet";

/**
 * Taking money out.
 *
 * One direction only. Money comes in by being sent to your handle or moved
 * across from another app; it goes out to a bank or to a wallet you own. There
 * is deliberately no way to put local currency in, so this screen never has to
 * ask for a card, and Selkie never has to hold anybody's card details.
 *
 * The flow is three screens and never fewer: where it goes, how much and to
 * whom, and a last look before it leaves. The last one is not a formality. A
 * cash out is the one action here that cannot be undone from inside the app, so
 * the numbers are laid out plainly, once, before it happens.
 *
 * On NEAR, "another wallet" is real: any NEAR account or exchange deposit
 * account, signed by the user's own key and relayed like every other payment.
 * "Another chain" goes through NEAR Intents: the server quotes it and prepares
 * a transfer to the quote's deposit address, the user signs that, and the
 * swap lands on the chain they picked. NEAR Intents is mainnet only, so on
 * testnet the review shows a real price marked as a preview. The bank route is
 * not built, and its last screen says so rather than pretending and failing.
 */

/** "chain" is NEAR Intents: USDC out to another chain. */
type Destination = "bank" | "wallet" | "chain";
type Step = "where" | "details" | "review" | "soon" | "done";

/** Where someone's bank is. Shapes the fields, and later the provider. */
const COUNTRIES = [
  { code: "NG", label: "Nigeria", currency: "NGN" },
  { code: "GH", label: "Ghana", currency: "GHS" },
  { code: "KE", label: "Kenya", currency: "KES" },
  { code: "ZA", label: "South Africa", currency: "ZAR" },
  { code: "US", label: "United States", currency: "USD" },
  { code: "GB", label: "United Kingdom", currency: "GBP" },
] as const;

export function CashOutPanel({ balance, onSent }: { balance: string; onSent?: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const nearPay = useNearPay();
  const target = useAccountCheck();
  const [step, setStep] = useState<Step>("where");
  const [destination, setDestination] = useState<Destination>("bank");
  const [amount, setAmount] = useState("");

  const [country, setCountry] = useState<string>(COUNTRIES[0].code);
  const [bank, setBank] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");

  const [address, setAddress] = useState("");
  const chains = useChainAssets(destination === "chain");
  const [pickedAsset, setPickedAsset] = useState<ChainAsset | null>(null);
  const chainAsset = pickedAsset ?? chains.assets?.[0] ?? null;
  const [chainQuote, setChainQuote] = useState<IntentsQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

  const available = Number(balance);
  const value = Number(amount);
  const tooMuch = value > available;
  const cleanAddress = ADDRESS.clean(address);
  const addressValid = ADDRESS.valid(cleanAddress);
  /** A NEAR account cash out moves money; so does another chain, where NEAR Intents is live. */
  const live = isNear && destination === "wallet";
  const toChain = isNear && destination === "chain";
  const chainAddress = address.trim();
  const chainProblem = chainAsset ? chainAddressProblem(chainAsset, chainAddress) : null;

  const detailsReady =
    destination === "bank"
      ? bank.trim().length > 0 && accountNumber.trim().length > 0 && accountName.trim().length > 0
      : toChain
        ? chainAsset !== null && chainAddress.length > 0 && !chainProblem
        : addressValid;
  const canReview = value > 0 && !tooMuch && detailsReady;

  const start = (to: Destination) => {
    setDestination(to);
    setStep("details");
  };

  const restart = () => {
    setStep("where");
    setAmount("");
    setBank("");
    setAccountNumber("");
    setAccountName("");
    setAddress("");
    setError(null);
    setResult(null);
    setChainQuote(null);
    target.reset();
  };

  /** On NEAR, look the account up first: say now if it is free or a contract. */
  const toReview = async () => {
    setError(null);
    if (toChain) return void (await priceChainCashOut());
    const problem = live ? await target.check(cleanAddress) : null;
    if (problem) {
      setError(problem);
      return;
    }
    setStep("review");
  };

  /** Another chain: a price first. The one that is signed is made again on the server at confirm. */
  const priceChainCashOut = async () => {
    if (!chainAsset) return;
    setQuoting(true);
    try {
      setChainQuote(
        await api.near.intents.quote({ direction: "out", assetId: chainAsset.assetId, amount, address: chainAddress }),
      );
      setStep("review");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not get a price just now. Try again.");
    } finally {
      setQuoting(false);
    }
  };

  /** The user's own key signs a transfer to NEAR Intents' deposit address; the swap does the rest. */
  const cashOutToChain = async () => {
    if (!chainAsset) return;
    setSending(true);
    setError(null);
    try {
      const sent = await nearPay(() =>
        api.near.prepareChainCashOut({ amount, toChain: { assetId: chainAsset.assetId, address: chainAddress } }),
      );
      setResult(sent);
      setStep("done");
      toast("success", sent.message);
      onSent?.();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "That did not go out. Your money is safe. Try again.";
      setError(message);
      toast("error", message);
    } finally {
      setSending(false);
    }
  };

  /** The user's own key signs a transfer out; Selkie's relayer pays the gas. */
  const cashOut = async () => {
    setSending(true);
    setError(null);
    try {
      const sent = await nearPay(() =>
        api.near.prepareTransfer({ toAccount: cleanAddress, amount, purpose: "cashout", toContract: target.toContract }),
      );
      setResult(sent);
      setStep("done");
      toast("success", sent.message);
      onSent?.();
    } catch (err) {
      if (target.fromRefusal(err)) return;
      const message =
        err instanceof ApiError ? err.message : "That did not go out. Your money is safe. Try again.";
      setError(message);
      toast("error", message);
    } finally {
      setSending(false);
    }
  };

  if (step === "done" && result) {
    return (
      <CashedOut
        amount={amount}
        to={toChain && chainAsset ? `${shortChainAddress(chainAddress)} on ${chainAsset.chainName}` : ADDRESS.short(cleanAddress)}
        result={result}
        onDone={restart}
        chainName={toChain ? chainAsset?.chainName : undefined}
      />
    );
  }

  if (step === "review" && toChain && chainQuote) {
    return (
      <ChainReview
        quote={chainQuote}
        address={chainAddress}
        onBack={() => setStep("details")}
        onConfirm={async () => {
          const yes = await confirm({
            title: `Send ${money(chainQuote.amountInFormatted)} to ${chainQuote.asset.chainName}?`,
            confirm: `Send to ${chainQuote.asset.chainName}`,
            rows: [
              { label: "To", value: shortChainAddress(chainAddress) },
              { label: "You get about", value: `${chainQuote.amountOutFormatted} ${chainQuote.asset.symbol}` },
            ],
            body: "Sends to another chain cannot be pulled back. Check the address is yours and on the right chain.",
          });
          if (yes) void cashOutToChain();
        }}
        sending={sending}
        error={error}
      />
    );
  }

  if (step === "soon") return <NotYet onDone={restart} />;

  if (step === "review") {
    return (
      <Review
        destination={destination}
        amount={amount}
        country={COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[0]}
        bank={bank}
        accountNumber={accountNumber}
        accountName={accountName}
        address={cleanAddress}
        onBack={() => setStep("details")}
        onConfirm={
          live
            ? async () => {
                const yes = await confirm({
                  title: `Send ${usd(amount)} out?`,
                  confirm: `Send ${usd(amount)}`,
                  rows: [
                    { label: "To", value: ADDRESS.short(cleanAddress) },
                    { label: "Amount", value: usd(amount) },
                  ],
                  body: "Money sent to another account cannot be pulled back.",
                });
                if (yes) void cashOut();
              }
            : () => setStep("soon")
        }
        sending={sending}
        error={error}
        contract={
          target.isContract ? { accepted: target.accepted, onAccept: target.setAccepted } : undefined
        }
      />
    );
  }

  if (step === "details") {
    return (
      <Panel>
        <Back onClick={() => setStep("where")} />
        <Steps at={2} />

        <PanelHead
          eyebrow="Cash out"
          title={destination === "bank" ? "How much, and to which account?" : "How much, and to where?"}
          blurb={
            destination === "bank"
              ? "We only ask for this once. Next time it is two taps."
              : toChain
                ? "NEAR Intents swaps your USDC and sends it to the chain you pick. You see the price before anything moves."
                : "Money sent to a wallet cannot be called back, so this is worth reading twice."
          }
        />

        <label className="label mt-6 block" htmlFor="cashout-amount">
          How much
        </label>
        <div className="relative mt-2">
          <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 font-display text-2xl font-bold text-pen/35">
            $
          </span>
          <input
            id="cashout-amount"
            className="field h-[4.5rem] pl-11 font-display text-[2rem] font-bold tracking-tight"
            placeholder="0.00"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(cleanAmount(e.target.value))}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Portions rather than round numbers. Cashing out is usually "most of
              it" or "all of it", not "twenty-five dollars of it". */}
          {([["25%", 0.25], ["Half", 0.5], ["Everything", 1]] as const).map(([label, share]) => {
            const portion = (available * share).toFixed(2);
            return (
              <button
                key={label}
                type="button"
                disabled={available <= 0}
                onClick={() => setAmount(portion)}
                className={`chip h-9 px-3.5 text-[13px] ${amount === portion && available > 0 ? "chip-on" : ""}`}
              >
                {label}
              </button>
            );
          })}
          <span className="ml-auto text-[13px] font-semibold text-pen/50">
            {usd(balance)} available
          </span>
        </div>

        {tooMuch && (
          <p className="mt-3 text-sm font-semibold text-[#a11d34]">
            {available <= 0
              ? "You have nothing to cash out yet."
              : `Your balance is too low. You can cash out ${usd(balance)} or less.`}
          </p>
        )}

        <hr className="rule my-6" />

        {destination === "bank" ? (
          <BankFields
            country={country}
            onCountry={setCountry}
            bank={bank}
            onBank={setBank}
            accountNumber={accountNumber}
            onAccountNumber={setAccountNumber}
            accountName={accountName}
            onAccountName={setAccountName}
          />
        ) : toChain ? (
          chains.error ? (
            <p className="text-sm font-semibold text-[#a11d34]">{chains.error}</p>
          ) : !chains.assets || !chainAsset ? (
            <p className="flex items-center gap-2 text-[14px] font-semibold text-pen/55">
              <Loader2 size={16} className="animate-spin" /> Asking NEAR Intents which chains are open
            </p>
          ) : (
            <ChainFields
              assets={chains.assets}
              asset={chainAsset}
              onAsset={setPickedAsset}
              address={address}
              onAddress={setAddress}
              problem={chainProblem}
            />
          )
        ) : (
          <WalletFields
            address={address}
            onAddress={setAddress}
            cleanAddress={cleanAddress}
            valid={addressValid}
          />
        )}

        {error && <p className="mt-4 text-sm font-semibold text-[#a11d34]">{error}</p>}

        <button
          onClick={() => void toReview()}
          disabled={!canReview || target.checking || quoting}
          className="btn btn-gold mt-7 w-full"
        >
          {target.checking || quoting ? (
            <>
              <Loader2 size={16} className="animate-spin" /> {quoting ? "Getting a price" : "Checking"}
            </>
          ) : (
            <>
              Review <ArrowRight size={16} strokeWidth={2.4} />
            </>
          )}
        </button>
      </Panel>
    );
  }

  return (
    <Panel>
      <Steps at={1} />
      <PanelHead
        eyebrow="Cash out"
        title="Where should it go?"
        blurb={`${isNear ? "A few" : "Two"} ways out, and you pick each time. Nothing leaves until you have seen the numbers.`}
      />

      <div className="mt-6 space-y-3">
        <Choice
          icon={<Building2 size={22} strokeWidth={2.2} />}
          title="Your bank account"
          blurb="Lands in your bank in your own currency, ready to spend anywhere."
          meta="A few minutes, usually"
          onClick={() => start("bank")}
        />
        <Choice
          icon={isNear ? <ChainLogo blockchain="near" name="NEAR" size={28} /> : <Wallet size={22} strokeWidth={2.2} />}
          title={isNear ? "A NEAR account or exchange" : "Another wallet"}
          blurb={
            isNear
              ? "Your own NEAR wallet, or an exchange's NEAR deposit account. Straight there, no fee."
              : "Any wallet you already have. Straight there, nothing in between."
          }
          meta="Seconds"
          onClick={() => start("wallet")}
        />
        {isNear && (
          <Choice
            icon={<ChainStack chains={CHAIN_PREVIEW} size={18} />}
            title="Another chain"
            blurb="USDC on Base, USDT on Tron and more, through NEAR Intents."
            meta={NEAR_NETWORK === "mainnet" ? "A few minutes" : "Preview on testnet"}
            onClick={() => start("chain")}
          />
        )}
      </div>

      <p className="mt-6 flex items-start gap-2.5 rounded-xl bg-pen/[0.05] p-3.5 text-[14px] leading-relaxed text-pen/70">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-gold-ink" />
        <span>
          You have {usd(balance)} to take out. Money you have sent that is still waiting for someone
          is not counted here, because it is not yours to spend until it comes back.
        </span>
      </p>
    </Panel>
  );
}

/** The marks on the "Another chain" choice: the chains people ask for most. */
const CHAIN_PREVIEW = [
  { blockchain: "base", name: "Base" },
  { blockchain: "tron", name: "Tron" },
  { blockchain: "sol", name: "Solana" },
];

/** One of the two ways out. Big enough to hit with a thumb, quiet enough to read. */
function Choice({
  icon,
  title,
  blurb,
  meta,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-2xl border-2 border-pen bg-card-bright p-4 text-left shadow-[0.18rem_0.24rem_0_rgba(3,9,15,0.55)] transition-[transform,box-shadow] duration-200 hover:-translate-x-px hover:-translate-y-0.5 hover:shadow-[0.3rem_0.4rem_0_rgba(3,9,15,0.55)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[0.06rem_0.08rem_0_rgba(3,9,15,0.55)]"
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border-2 border-pen/15 bg-pen/[0.05] text-pen/75 transition-colors group-hover:border-gold group-hover:bg-gold/15 group-hover:text-gold-ink">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[17px] font-bold tracking-tight">{title}</span>
        <span className="mt-0.5 block text-[14px] leading-relaxed text-pen/60">{blurb}</span>
      </span>
      <span className="hidden shrink-0 items-center gap-1.5 text-[12px] font-bold text-pen/45 sm:flex">
        <Clock size={13} strokeWidth={2.4} />
        {meta}
      </span>
      <ArrowRight
        size={18}
        strokeWidth={2.4}
        className="shrink-0 text-pen/30 transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-pen/70"
      />
    </button>
  );
}

function BankFields({
  country,
  onCountry,
  bank,
  onBank,
  accountNumber,
  onAccountNumber,
  accountName,
  onAccountName,
}: {
  country: string;
  onCountry: (value: string) => void;
  bank: string;
  onBank: (value: string) => void;
  accountNumber: string;
  onAccountNumber: (value: string) => void;
  accountName: string;
  onAccountName: (value: string) => void;
}) {
  return (
    <>
      <p className="label">Your bank</p>

      <div className="relative mt-2">
        <select
          aria-label="Country"
          className="field appearance-none pr-11"
          value={country}
          onChange={(e) => onCountry(e.target.value)}
        >
          {COUNTRIES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={17}
          strokeWidth={2.4}
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-pen/45"
        />
      </div>

      <input
        className="field mt-2.5"
        placeholder="Bank name"
        autoCapitalize="words"
        value={bank}
        onChange={(e) => onBank(e.target.value)}
      />
      <input
        className="field mt-2.5"
        placeholder="Account number"
        inputMode="numeric"
        autoCorrect="off"
        value={accountNumber}
        onChange={(e) => onAccountNumber(e.target.value.replace(/[^0-9]/g, ""))}
      />
      <input
        className="field mt-2.5"
        placeholder="Name on the account"
        autoCapitalize="words"
        value={accountName}
        onChange={(e) => onAccountName(e.target.value)}
      />

      <p className="mt-3 text-[13px] leading-relaxed text-pen/55">
        The name has to match the account, or the bank sends it straight back.
      </p>
    </>
  );
}

function WalletFields({
  address,
  onAddress,
  cleanAddress,
  valid,
}: {
  address: string;
  onAddress: (value: string) => void;
  cleanAddress: string;
  valid: boolean;
}) {
  return (
    <>
      <label className="label block" htmlFor="cashout-address">
        {ADDRESS.label}
      </label>
      <textarea
        id="cashout-address"
        className="field mt-2 min-h-[5.25rem] resize-none break-all font-mono text-[13px] leading-relaxed"
        placeholder={ADDRESS.placeholder}
        autoCapitalize={ADDRESS.capitalize}
        autoCorrect="off"
        spellCheck={false}
        value={address}
        onChange={(e) => onAddress(e.target.value)}
      />
      {cleanAddress.length > 0 && !valid && (
        <p className="mt-2 text-sm font-semibold text-[#a11d34]">{ADDRESS.invalid}</p>
      )}
      <p className="mt-3 flex items-start gap-2.5 rounded-xl bg-[#a11d34]/[0.07] p-3.5 text-[14px] leading-relaxed text-pen/75">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#a11d34]" />
        <span>
          {isNear
            ? "Only send to an account you own, and check every character. For an exchange, use the NEAR deposit account it shows you and make sure it takes USDC on NEAR. Money sent to the wrong account cannot be recovered by anyone."
            : "Only send to a wallet you own, and check every character. Money sent to the wrong address cannot be recovered by anyone."}
        </span>
      </p>
    </>
  );
}

function ChainFields({
  assets,
  asset,
  onAsset,
  address,
  onAddress,
  problem,
}: {
  assets: ChainAsset[];
  asset: ChainAsset;
  onAsset: (asset: ChainAsset) => void;
  address: string;
  onAddress: (value: string) => void;
  problem: string | null;
}) {
  return (
    <>
      <label className="label block" htmlFor="cashout-asset">
        What it arrives as
      </label>
      <AssetSelect id="cashout-asset" assets={assets} value={asset.assetId} onChange={onAsset} />

      <label className="label mt-5 flex items-center gap-2" htmlFor="cashout-chain-address">
        <ChainLogo blockchain={asset.blockchain} name={asset.chainName} size={18} />
        Your address on {asset.chainName}
      </label>
      <textarea
        id="cashout-chain-address"
        className="field mt-2 min-h-[4.5rem] resize-none break-all font-mono text-[13px] leading-relaxed"
        placeholder={addressPlaceholder(asset)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={address}
        onChange={(e) => onAddress(e.target.value)}
      />
      {problem && <p className="mt-2 text-sm font-semibold text-[#a11d34]">{problem}</p>}
      <p className="mt-3 flex items-start gap-2.5 rounded-xl bg-[#a11d34]/[0.07] p-3.5 text-[14px] leading-relaxed text-pen/75">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#a11d34]" />
        <span>
          Only an address you own on {asset.chainName} that takes {asset.symbol}, and check every character. If the
          swap fails, the USDC comes back to your Selkie account; sent to the wrong address, nobody can recover it.
        </span>
      </p>
    </>
  );
}

/** The last look before USDC leaves for another chain: what goes, what arrives, where. */
function ChainReview({
  quote,
  address,
  onBack,
  onConfirm,
  sending,
  error,
}: {
  quote: IntentsQuote;
  address: string;
  onBack: () => void;
  onConfirm: () => void;
  sending: boolean;
  error: string | null;
}) {
  return (
    <Panel>
      <Back onClick={onBack} />
      <Steps at={3} />

      <div className="mt-1 flex flex-col items-center text-center">
        <CoinOnChain symbol={quote.asset.symbol} blockchain={quote.asset.blockchain} chainName={quote.asset.chainName} size={52} />
        <p className="mt-5 eyebrow">Taking out</p>
        <p className="mt-1.5 font-display text-[3rem] font-bold leading-none tracking-tight">
          {money(quote.amountInFormatted)}
        </p>
        <p className="mt-2 text-[15px] font-semibold text-pen/55">USDC</p>
      </div>

      <div className="mt-7 overflow-hidden rounded-2xl border-2 border-pen/15 bg-card-bright">
        <Line
          label="To"
          value={address}
          mono
          wrap
          icon={<ChainLogo blockchain={quote.asset.blockchain} name={quote.asset.chainName} size={18} />}
        />
        <Line
          label="Arrives as"
          value={assetName(quote.asset)}
          icon={<CoinOnChain symbol={quote.asset.symbol} blockchain={quote.asset.blockchain} chainName={quote.asset.chainName} size={20} />}
        />
        <Line label="You get about" value={`${quote.amountOutFormatted} ${quote.asset.symbol}`} />
        {quote.minAmountOutFormatted && (
          <Line label="At least" value={`${quote.minAmountOutFormatted} ${quote.asset.symbol}`} />
        )}
        <Line label="Fee" value="In the price. Gas is on us." />
        <Line label="Arrives" value={inAbout(quote.timeEstimate)} />
      </div>

      {quote.preview && <PreviewNote what="nothing leaves your account from here. Cash out to a NEAR account in the meantime." />}

      {error && <p className="mt-4 text-center text-sm font-semibold text-[#a11d34]">{error}</p>}

      <button onClick={onConfirm} disabled={sending || quote.preview} className="btn btn-gold mt-7 w-full">
        {sending ? <Loader2 size={16} className="animate-spin" /> : null}
        {sending ? "Sending" : quote.preview ? "Sending works on mainnet" : `Send to ${quote.asset.chainName}`}
      </button>
      <button onClick={onBack} disabled={sending} className="btn btn-dim mt-2.5 w-full">
        Change something
      </button>
    </Panel>
  );
}

function Review({
  destination,
  amount,
  country,
  bank,
  accountNumber,
  accountName,
  address,
  onBack,
  onConfirm,
  sending = false,
  error = null,
  contract,
}: {
  destination: Destination;
  amount: string;
  country: (typeof COUNTRIES)[number];
  bank: string;
  accountNumber: string;
  accountName: string;
  address: string;
  onBack: () => void;
  onConfirm: () => void;
  sending?: boolean;
  error?: string | null;
  /** Set when the account runs a contract: the warning, and whether they accepted it. */
  contract?: { accepted: boolean; onAccept: (accepted: boolean) => void };
}) {
  const toBank = destination === "bank";

  return (
    <Panel>
      <Back onClick={onBack} />
      <Steps at={3} />

      <div className="mt-1 flex flex-col items-center text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl border-2 border-pen/20 bg-pen/[0.06] text-pen/70">
          {toBank ? <Building2 size={24} strokeWidth={2.2} /> : <Wallet size={24} strokeWidth={2.2} />}
        </span>
        <p className="mt-5 eyebrow">Taking out</p>
        <p className="mt-1.5 font-display text-[3rem] font-bold leading-none tracking-tight">
          {money(amount)}
        </p>
        <p className="mt-2 text-[15px] font-semibold text-pen/55">USDC</p>
      </div>

      <div className="mt-7 overflow-hidden rounded-2xl border-2 border-pen/15 bg-card-bright">
        {toBank ? (
          <>
            <Line label="To" value={`${accountName || "—"}`} />
            <Line label="Account" value={accountNumber ? `${bank} · ${accountNumber}` : bank} mono />
            <Line label="Country" value={country.label} />
            {/* Blank on purpose. A made-up rate on a screen about money is worse
                than an honest dash, and the real one comes from whoever ends up
                doing the transfer. */}
            <Line label="Fee" value="—" muted />
            <Line label={`You get about`} value={`— ${country.currency}`} muted />
          </>
        ) : (
          <>
            <Line
              label="To"
              value={address}
              mono
              wrap
              icon={isNear ? <ChainLogo blockchain="near" name="NEAR" size={18} /> : undefined}
            />
            <Line label="Fee" value="None. We cover it." />
            <Line label="Arrives" value="In a few seconds" />
          </>
        )}
      </div>

      {toBank && (
        <p className="mt-3 text-[13px] leading-relaxed text-pen/55">
          The rate and the fee appear here the moment your bank is connected, and you will always see
          them before anything moves.
        </p>
      )}

      {contract && <ContractWarning accountId={address} accepted={contract.accepted} onAccept={contract.onAccept} />}

      {error && <p className="mt-4 text-center text-sm font-semibold text-[#a11d34]">{error}</p>}

      <button
        onClick={onConfirm}
        disabled={sending || (contract !== undefined && !contract.accepted)}
        className="btn btn-gold mt-7 w-full"
      >
        {sending ? <Loader2 size={16} className="animate-spin" /> : null}
        {sending ? "Sending" : toBank ? "Send to my bank" : isNear ? "Send to this account" : "Send to my wallet"}
      </button>
      <button onClick={onBack} disabled={sending} className="btn btn-dim mt-2.5 w-full">
        Change something
      </button>
    </Panel>
  );
}

function Line({
  label,
  value,
  mono,
  muted,
  wrap,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
  wrap?: boolean;
  /** A chain or coin mark before the value. */
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-t-2 border-pen/[0.08] px-4 py-3.5 first:border-t-0">
      <span className="shrink-0 text-[14px] font-semibold text-pen/55">{label}</span>
      <span className="flex min-w-0 items-start justify-end gap-2">
        {icon && <span className="mt-px shrink-0">{icon}</span>}
        <span
          className={`min-w-0 text-right text-[14px] font-bold ${muted ? "text-pen/40" : "text-pen/85"} ${
            mono ? "font-mono text-[12.5px]" : ""
          } ${wrap ? "break-all" : "truncate"}`}
        >
          {value}
        </span>
      </span>
    </div>
  );
}

/**
 * The end of the flow, for now.
 *
 * Honest rather than triumphant. Everything above this is real and finished;
 * the piece that actually moves the money is not, and a fake receipt would be a
 * worse thing to ship than an empty screen.
 */
function NotYet({ onDone }: { onDone: () => void }) {
  return (
    <Panel>
      <div className="flex flex-col items-center py-4 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full border-2 border-gold bg-gold/15 text-gold-ink">
          <Clock size={26} strokeWidth={2.2} />
        </span>
        <p className="mt-5 font-display text-2xl font-bold tracking-tight">
          Almost open
        </p>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-pen/65">
          Cashing out to a bank is the last piece we are putting in. Your money is exactly where you left it,
          and this will start working without you having to do anything.
        </p>
        <div className="mt-7 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
          <Link href="/wallet/home" className="btn btn-gold sm:px-8">
            Back to my wallet
          </Link>
          <button onClick={onDone} className="btn btn-dim sm:px-8">
            Have another look
          </button>
        </div>
      </div>
    </Panel>
  );
}

/** Money left, for real: the amount, where it went, and the transaction to check it by. */
function CashedOut({
  amount,
  to,
  result,
  onDone,
  chainName,
}: {
  amount: string;
  /** Already shortened for reading. */
  to: string;
  result: SendResult;
  onDone: () => void;
  /** Set for a cash-out to another chain, to follow the swap. */
  chainName?: string;
}) {
  return (
    <Panel>
      <div className="flex flex-col items-center py-4 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full border-2 border-[#2f7d3f]/40 bg-[#2f7d3f]/12 text-[#2f7d3f]">
          <Check size={30} strokeWidth={2.6} />
        </span>
        <p className="mt-5 font-display text-[2rem] font-bold leading-none tracking-tight">{usd(amount)}</p>
        <p className="mt-2 max-w-sm break-all font-mono text-[14px] font-bold text-pen/75">
          to {to}
        </p>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-pen/65">{result.message}</p>
        {result.explorer && (
          <a
            href={result.explorer}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-bold text-pen/55 transition-colors hover:text-pen"
          >
            See it on the NEAR explorer <ExternalLink size={13} />
          </a>
        )}
        {result.intents && chainName && (
          <IntentsProgress depositAddress={result.intents.depositAddress} direction="out" chainName={chainName} />
        )}
        <div className="mt-7 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
          <Link href="/wallet/home" className="btn btn-gold sm:px-8">
            Back to my wallet
          </Link>
          <button onClick={onDone} className="btn btn-dim sm:px-8">
            Cash out more
          </button>
        </div>
      </div>
    </Panel>
  );
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-[13px] font-bold text-pen/55 transition-colors hover:text-pen"
    >
      <ArrowLeft size={15} /> Back
    </button>
  );
}

/** Where you are in the flow. Three dots, because three is countable at a glance. */
function Steps({ at }: { at: 1 | 2 | 3 }) {
  return (
    <div className="mb-5 mt-4 flex items-center gap-1.5" aria-hidden>
      {[1, 2, 3].map((step) => (
        <span
          key={step}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            step === at
              ? "w-7 bg-gradient-to-r from-gold-light to-gold"
              : step < at
                ? "w-3 bg-pen/30"
                : "w-3 bg-pen/12"
          }`}
        />
      ))}
    </div>
  );
}
