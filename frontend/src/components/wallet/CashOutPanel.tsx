"use client";

import { useEffect, useState } from "react";
import { Building2, Wallet } from "lucide-react";
import { ChainLogo, CoinOnChain } from "@/components/ChainLogo";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/useConfirm";
import { ADDRESS } from "@/lib/address";
import { ApiError, api, type BankQuote, type ChainAsset, type SendResult } from "@/lib/api";
import { bankLine, currencyOf, fiat, useAccountName, useBankQuote, useBanks } from "@/lib/bank";
import { isNear } from "@/lib/chain";
import { money, usd } from "@/lib/format";
import { chainAddressProblem, shortChainAddress, useChainAssets, useOutQuote } from "@/lib/other-chain";
import { useAccountCheck } from "@/lib/near-account";
import { useNearPay } from "@/lib/near-wallet";
import { AmountStep } from "./cashout/Amount";
import { Back, Stepper, Surface, Trail } from "./cashout/bits";
import { DetailsStep, type Lookup } from "./cashout/Details";
import { DoneStep, NotYet } from "./cashout/Done";
import { ReviewStep } from "./cashout/Review";
import { WhereStep } from "./cashout/Where";
import {
  COUNTRIES,
  EMPTY_BANK,
  bankReady,
  checkAmount,
  flowIndex,
  toCents,
  type BankDetails,
  type Destination,
  type Step,
} from "./cashout/model";

/**
 * Taking money out.
 *
 * One direction only. Money comes in by being sent to your handle or moved
 * across from another app; it goes out to a bank or to a wallet you own. There
 * is deliberately no way to put local currency in, so this screen never has to
 * ask for a card, and Selkie never has to hold anybody's card details.
 *
 * Four steps, each asking one thing: where it goes, how much, the details for
 * that place, and a last look. Every step can be revisited from the step bar
 * or the trail of choices, and nothing typed is lost on the way back. The last
 * look is not a formality: a cash out is the one action here that cannot be
 * undone from inside the app.
 *
 * On NEAR, "another wallet" is real: any NEAR account or exchange deposit
 * account, signed by the user's own key and relayed like every other payment.
 * "Another chain" goes through NEAR Intents: the server quotes it and prepares
 * a transfer to the quote's deposit address, the user signs that, and the
 * swap lands on the chain they picked. NEAR Intents is mainnet only, so on
 * testnet the review shows a real price marked as a preview. "A bank" goes
 * through Paycrest: the server makes a Paycrest order and a NEAR Intents quote
 * that pays it exactly, and the user signs one transfer. Banks, rates and the
 * name check are real everywhere; sending needs mainnet and Paycrest's key,
 * and until then the review says it is a preview. On Stellar the bank route
 * is not built, and says so on its first card and its last screen.
 */
export function CashOutPanel({ balance, onSent }: { balance: string; onSent?: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const nearPay = useNearPay();
  const target = useAccountCheck();

  const [step, setStep] = useState<Step>("where");
  const [from, setFrom] = useState<"ahead" | "back">("ahead");
  const [destination, setDestination] = useState<Destination | null>(null);
  const [amount, setAmount] = useState("");
  const [bank, setBank] = useState<BankDetails>(EMPTY_BANK);
  /** A NEAR account (or a Stellar address). Kept apart from the other-chain address on purpose. */
  const [address, setAddress] = useState("");
  const [chainAddressRaw, setChainAddress] = useState("");
  const [pickedAsset, setPickedAsset] = useState<ChainAsset | null>(null);
  const [lookup, setLookup] = useState<Pick<Lookup, "forAddress" | "problem">>({ forAddress: null, problem: null });
  const [sending, setSending] = useState(false);
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

  const toChain = isNear && destination === "chain";
  /** NEAR: a bank account through Paycrest. */
  const toBank = isNear && destination === "bank";
  const bankSteps = toBank && (step === "details" || step === "review");
  const banks = useBanks(toBank ? bank.currency : null);
  const nameCheck = useAccountName({
    currency: bank.currency,
    institution: bank.institution,
    accountNumber: bank.accountNumber,
    active: bankSteps,
  });
  const payout = useBankQuote({ currency: bank.currency, amount, active: bankSteps, refreshSeconds: sending ? 0 : 30 });
  /** Pressing send moves money now: a NEAR account, another chain (where NEAR Intents is live), or a bank (where Paycrest is on). */
  const live =
    isNear && (destination === "wallet" || destination === "chain" || (destination === "bank" && Boolean(payout.quote?.payoutsOn)));

  // The name the bank has is the name on the order. Typed only when it does not share one.
  const foundName = nameCheck.name;
  useEffect(() => {
    if (toBank && foundName) setBank((was) => (was.accountName === foundName ? was : { ...was, accountName: foundName }));
  }, [toBank, foundName]);

  const chains = useChainAssets(toChain);
  const chainAsset = pickedAsset ?? chains.assets?.[0] ?? null;
  const chainAddress = chainAddressRaw.trim();
  const chainProblem = chainAsset ? chainAddressProblem(chainAsset, chainAddress) : null;

  const cleanAddress = ADDRESS.clean(address);
  const addressValid = ADDRESS.valid(cleanAddress);
  const amountCheck = checkAmount(amount, balance);
  const country = COUNTRIES.find((c) => c.code === bank.country) ?? COUNTRIES[0];

  const quote = useOutQuote({
    asset: chainAsset,
    amount,
    address: chainAddress,
    active: toChain && (step === "details" || step === "review"),
    refreshSeconds: sending ? 0 : 30,
  });

  /** Look a NEAR account up as it is typed, so "no such account" shows before Review, not after. */
  const checkAccount = target.check;
  useEffect(() => {
    if (!(isNear && destination === "wallet" && step === "details" && addressValid)) return;
    if (lookup.forAddress === cleanAddress) return;
    let alive = true;
    const wait = setTimeout(async () => {
      const problem = await checkAccount(cleanAddress);
      if (alive) setLookup({ forAddress: cleanAddress, problem });
    }, 550);
    return () => {
      alive = false;
      clearTimeout(wait);
    };
  }, [destination, step, addressValid, cleanAddress, lookup.forAddress, checkAccount]);

  const go = (next: Step) => {
    setFrom(flowIndex(next) >= flowIndex(step) ? "ahead" : "back");
    setError(null);
    setStep(next);
  };

  const pick = (to: Destination) => {
    // A contract warning accepted for one account must not carry over to another route.
    // Forget the lookup too, so coming back to this route checks the account afresh.
    if (to !== destination) {
      target.reset();
      setLookup({ forAddress: null, problem: null });
    }
    setDestination(to);
    go("amount");
  };

  const bankChecked = nameCheck.checked && !nameCheck.problem && bank.accountName.trim().length > 1;
  /** Why a bank cash-out that is otherwise ready cannot go: the swap takes it over the balance. */
  const bankStop =
    toBank && payout.quote?.sendAbout && toCents(payout.quote.sendAbout) > toCents(balance)
      ? `With the swap this takes about ${money(payout.quote.sendAbout)} USDC, more than you have. Lower the amount.`
      : toBank && payout.quote?.payoutsOn && !payout.quote.sendAtMost
        ? "Could not price the swap to the bank just now. Wait a moment for the price to update."
        : null;

  const detailsReady =
    destination === "bank"
      ? toBank
        ? bankChecked && payout.quote !== null
        : bankReady(bank)
      : toChain
        ? chainAsset !== null && chainAddress.length > 0 && !chainProblem && quote.quote !== null
        : addressValid && !(lookup.forAddress === cleanAddress && lookup.problem);

  const toReview = async () => {
    setError(null);
    if (isNear && destination === "wallet" && lookup.forAddress !== cleanAddress) {
      setWaitingFor("Checking the account");
      const problem = await target.check(cleanAddress);
      setWaitingFor(null);
      setLookup({ forAddress: cleanAddress, problem });
      if (problem) return setError(problem);
    }
    go("review");
  };

  const restart = () => {
    setFrom("back");
    setStep("where");
    setAmount("");
    setBank(EMPTY_BANK);
    setAddress("");
    setChainAddress("");
    setLookup({ forAddress: null, problem: null });
    setError(null);
    setResult(null);
    target.reset();
  };

  const finish = (sent: SendResult) => {
    setResult(sent);
    setFrom("ahead");
    setStep("done");
    toast("success", sent.message);
    onSent?.();
  };

  const failed = (err: unknown) => {
    const message = err instanceof ApiError ? err.message : "That did not go out. Your money is safe. Try again.";
    setError(message);
    toast("error", message);
  };

  /** The user's own key signs a transfer to NEAR Intents' deposit address; the swap does the rest. */
  const cashOutToChain = async () => {
    if (!chainAsset) return;
    setSending(true);
    setError(null);
    try {
      finish(await nearPay(() => api.near.prepareChainCashOut({ amount, toChain: { assetId: chainAsset.assetId, address: chainAddress } })));
    } catch (err) {
      failed(err);
    } finally {
      setSending(false);
    }
  };

  /**
   * The server makes the Paycrest order and the NEAR Intents quote that pays
   * it; the user's key signs one transfer. `maxSend` is the most they agreed to.
   */
  const cashOutToBank = async (priced: BankQuote) => {
    if (!priced.sendAtMost) return;
    setSending(true);
    setError(null);
    try {
      finish(
        await nearPay(() =>
          api.near.prepareBankCashOut({
            amount,
            toBank: {
              currency: bank.currency,
              institution: bank.institution,
              accountIdentifier: bank.accountNumber,
              accountName: bank.accountName.trim(),
              maxSend: priced.sendAtMost!,
            },
          }),
        ),
      );
    } catch (err) {
      failed(err);
    } finally {
      setSending(false);
    }
  };

  /** The user's own key signs a transfer out; Selkie's relayer pays the gas. */
  const cashOut = async () => {
    setSending(true);
    setError(null);
    try {
      finish(
        await nearPay(() =>
          api.near.prepareTransfer({ toAccount: cleanAddress, amount, purpose: "cashout", toContract: target.toContract }),
        ),
      );
    } catch (err) {
      if (!target.fromRefusal(err)) failed(err);
    } finally {
      setSending(false);
    }
  };

  const onConfirm = async () => {
    if (toBank) {
      const q = payout.quote;
      if (!q || !q.payoutsOn || !q.sendAtMost || bankStop) return;
      const yes = await confirm({
        title: `Send ${fiat(q.fiatAmount, q.currency)} to ${bank.bank}?`,
        confirm: "Send to the bank",
        rows: [
          { label: "To", value: `${bank.accountName.trim()}, ${bankLine(bank.bank, bank.accountNumber)}` },
          { label: "You send", value: `About ${money(q.sendAbout ?? amount)} USDC, at most ${money(q.sendAtMost)}` },
          { label: "They get about", value: fiat(q.fiatAmount, q.currency) },
        ],
        body: "Once Paycrest pays the bank it cannot be pulled back. If the swap on the way fails, your USDC comes back to your account.",
      });
      if (yes) void cashOutToBank(q);
      return;
    }
    if (toChain) {
      const q = quote.quote;
      if (!q || !chainAsset) return;
      const yes = await confirm({
        title: `Send ${money(q.amountInFormatted)} to ${chainAsset.chainName}?`,
        confirm: `Send to ${chainAsset.chainName}`,
        rows: [
          { label: "To", value: shortChainAddress(chainAddress) },
          { label: "You get about", value: `${q.amountOutFormatted} ${chainAsset.symbol}` },
        ],
        body: "Sends to another chain cannot be pulled back. Check the address is yours and on the right chain.",
      });
      if (yes) void cashOutToChain();
      return;
    }
    if (live) {
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
      return;
    }
    go("soon");
  };

  const destinationText: Record<Destination, string> = {
    bank: toBank && flowIndex(step) > flowIndex("details") ? currencyOf(bank.currency).name : isNear ? "A bank account" : "Your bank",
    wallet: isNear ? "A NEAR account" : "Another wallet",
    chain: chainAsset && flowIndex(step) > flowIndex("details") ? chainAsset.chainName : "Another chain",
  };
  const destinationIcon: Record<Destination, React.ReactNode> = {
    bank: <Building2 size={14} />,
    wallet: isNear ? <ChainLogo blockchain="near" name="NEAR" size={16} /> : <Wallet size={14} />,
    chain: chainAsset ? (
      <CoinOnChain symbol={chainAsset.symbol} blockchain={chainAsset.blockchain} chainName={chainAsset.chainName} size={16} />
    ) : null,
  };

  const inFlow = flowIndex(step) >= 0;
  const trail =
    destination && inFlow && step !== "where"
      ? [
          {
            key: "where",
            label: "Change where it goes",
            icon: destinationIcon[destination],
            text: destinationText[destination],
            onClick: () => go("where"),
          },
          ...(flowIndex(step) > flowIndex("amount") && amountCheck.ok
            ? [{ key: "amount", label: "Change the amount", text: <span className="co-mono">{money(amount)} USDC</span>, onClick: () => go("amount") }]
            : []),
          ...(step === "review" && (destination !== "bank" || toBank)
            ? [
                {
                  key: "details",
                  label: toBank ? "Change the bank account" : "Change the address",
                  text: (
                    <span className="co-mono">
                      {toBank ? bankLine(bank.bank, bank.accountNumber) : toChain ? shortChainAddress(chainAddress) : ADDRESS.short(cleanAddress)}
                    </span>
                  ),
                  onClick: () => go("details"),
                },
              ]
            : []),
        ]
      : [];

  const backTo: Partial<Record<Step, Step>> = { amount: "where", details: "amount", review: "details" };

  return (
    <Surface label="Cash out">
      {inFlow && (
        <>
          <div className="co-top">
            <p className="co-kicker">
              <i aria-hidden="true" />
              Cash out
            </p>
            {backTo[step] && <Back onClick={() => go(backTo[step]!)} />}
          </div>
          <Stepper at={step} onJump={go} />
          <Trail items={trail} />
        </>
      )}

      <div key={step} className="co-enter" data-from={from}>
        {step === "where" && <WhereStep picked={destination} balance={balance} onPick={pick} />}

        {step === "amount" && destination && (
          <AmountStep destination={destination} amount={amount} onAmount={setAmount} balance={balance} onContinue={() => go("details")} />
        )}

        {step === "details" && destination && (
          <DetailsStep
            destination={destination}
            bank={bank}
            onBank={(patch) => setBank((was) => ({ ...was, ...patch }))}
            address={address}
            onAddress={(value) => {
              setAddress(value);
              setError(null);
            }}
            cleanAddress={cleanAddress}
            addressValid={addressValid}
            lookup={{ ...lookup, checking: target.checking, found: target.info }}
            chains={chains}
            asset={chainAsset}
            onAsset={setPickedAsset}
            chainAddress={chainAddressRaw}
            onChainAddress={setChainAddress}
            chainProblem={chainProblem}
            quote={quote}
            paycrest={toBank ? { banks, name: nameCheck, quote: payout } : undefined}
            error={error}
            ready={amountCheck.ok && detailsReady}
            busy={waitingFor}
            onContinue={() => void toReview()}
          />
        )}

        {step === "review" && destination && (
          <ReviewStep
            destination={destination}
            amount={amount}
            live={live}
            address={cleanAddress}
            chain={
              toChain && chainAsset && quote.quote
                ? { asset: chainAsset, address: chainAddress, quote: quote.quote, at: quote.at, loading: quote.loading }
                : null
            }
            payout={toBank && payout.quote ? { quote: payout.quote, at: payout.at, loading: payout.loading } : null}
            stop={bankStop}
            bank={bank}
            country={country}
            contract={destination === "wallet" && target.isContract ? { accepted: target.accepted, onAccept: target.setAccepted } : undefined}
            sending={sending}
            error={error ?? (toChain && !quote.quote ? quote.error : toBank && !payout.quote ? payout.error : null)}
            onConfirm={() => void onConfirm()}
            onBack={() => go("details")}
          />
        )}

        {step === "soon" && <NotYet onDone={restart} />}

        {step === "done" && result && (
          <DoneStep
            amount={amount}
            to={
              result.bank
                ? `${result.bank.institutionName} ••${result.bank.accountLast4}`
                : toChain && chainAsset
                  ? `${shortChainAddress(chainAddress)} on ${chainAsset.chainName}`
                  : ADDRESS.short(cleanAddress)
            }
            result={result}
            chain={toChain ? (chainAsset ?? undefined) : undefined}
            onAgain={restart}
          />
        )}
      </div>
    </Surface>
  );
}
