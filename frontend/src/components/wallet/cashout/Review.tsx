"use client";

import { Building2, Eye, Loader2, PenLine } from "lucide-react";
import { ChainLogo, CoinOnChain } from "@/components/ChainLogo";
import { PreviewNote } from "@/components/wallet/OtherChain";
import type { BankQuote, ChainAsset, IntentsQuote } from "@/lib/api";
import { bankLine, fiat, previewLabel } from "@/lib/bank";
import { isNear } from "@/lib/chain";
import { money } from "@/lib/format";
import { assetName, inAbout } from "@/lib/other-chain";
import { ContractNotice, Fresh, Head, Note, Row } from "./bits";
import type { BankDetails, Country, Destination } from "./model";

/**
 * The last look. A cash out is the one action here that cannot be undone
 * from inside the app, so what leaves, what arrives and where are laid out
 * once, plainly, with a single button that says what it does.
 */
export function ReviewStep({
  destination,
  amount,
  live,
  address,
  chain,
  payout,
  stop,
  bank,
  country,
  contract,
  sending,
  error,
  onConfirm,
  onBack,
}: {
  destination: Destination;
  amount: string;
  /** True when pressing send moves money now (NEAR account, or another chain on mainnet). */
  live: boolean;
  address: string;
  chain: { asset: ChainAsset; address: string; quote: IntentsQuote; at: number; loading: boolean } | null;
  /** NEAR: a bank cash-out through Paycrest, priced live. */
  payout?: { quote: BankQuote; at: number; loading: boolean } | null;
  /** Set when it cannot go as it stands, and why. */
  stop?: string | null;
  bank: BankDetails;
  country: Country;
  contract?: { accepted: boolean; onAccept: (accepted: boolean) => void };
  sending: boolean;
  error: string | null;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const toBank = destination === "bank";
  const paid = toBank ? (payout?.quote ?? null) : null;
  const preview = Boolean(chain?.quote.preview) || (paid !== null && !paid.payoutsOn);
  const blocked = sending || preview || Boolean(stop) || (contract !== undefined && !contract.accepted);

  return (
    <>
      <Head
        title="Check it, then send"
        blurb={
          chain || paid
            ? "The price updates while you look. The final one is fixed the moment you sign."
            : toBank
              ? "Last look before it goes to your bank."
              : "Money sent to another account cannot be pulled back, so check the name once more."
        }
      />

      <div className="co-receipt mt-6">
        <div className="co-flow">
          <div className="co-flow-side">
            <span className="min-w-0">
              <small>{paid?.sendAbout ? "You send about" : "You send"}</small>
              <span className="co-flow-amount">
                {money(paid?.sendAbout ?? amount)}
                <em>USDC</em>
              </span>
            </span>
            {isNear && <CoinOnChain symbol="USDC" blockchain="near" chainName="NEAR" size={34} />}
          </div>
          <span className="co-sink" aria-hidden="true" />
          <div className="co-flow-side co-flow-get">
            <span className="min-w-0">
              <small>{chain || paid ? "They get about" : toBank ? "Your bank pays out" : "Arrives as"}</small>
              <span className="co-flow-amount">
                {paid ? (
                  <>
                    {fiat(paid.fiatAmount, paid.currency)}
                    <em>{paid.currency}</em>
                  </>
                ) : chain ? (
                  <>
                    {chain.quote.amountOutFormatted}
                    <em>{assetName(chain.asset)}</em>
                  </>
                ) : toBank ? (
                  <>
                    —<em>{country.currency}, rate shown once connected</em>
                  </>
                ) : (
                  <>
                    {money(amount)}
                    <em>USDC{isNear ? " on NEAR" : ""}</em>
                  </>
                )}
              </span>
            </span>
            {chain ? (
              <CoinOnChain symbol={chain.asset.symbol} blockchain={chain.asset.blockchain} chainName={chain.asset.chainName} size={34} />
            ) : toBank ? (
              <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-[#1a1e28] text-[rgba(233,241,236,.7)]">
                <Building2 size={17} />
              </span>
            ) : null}
          </div>
        </div>

        {paid ? (
          <>
            <Row label="To">{bank.accountName}</Row>
            <Row label="Account" mono>
              {bankLine(bank.bank, bank.accountNumber)}
            </Row>
            <Row label="Rate">{fiat(paid.rate, paid.currency)} per USDC</Row>
            <Row label="Order for">{money(paid.amount)} USDC</Row>
            {paid.sendAtMost && <Row label="At most">{money(paid.sendAtMost)} USDC, the rest comes back</Row>}
            <Row label="Fees">In the rate and the swap. Gas is on us.</Row>
            <Row label="Arrives">Usually within a few minutes</Row>
          </>
        ) : toBank ? (
          <>
            <Row label="To">{bank.accountName || "—"}</Row>
            <Row label="Account" mono>
              {bank.accountNumber ? `${bank.bank} · ${bank.accountNumber}` : bank.bank}
            </Row>
            <Row label="Country">{country.label}</Row>
            {/* Blank on purpose: a made-up rate on a screen about money is worse
                than an honest dash, and the real one comes from the provider. */}
            <Row label="Fee" muted>
              —
            </Row>
          </>
        ) : chain ? (
          <>
            <Row label="To" mono icon={<ChainLogo blockchain={chain.asset.blockchain} name={chain.asset.chainName} size={16} />}>
              {chain.address}
            </Row>
            {chain.quote.minAmountOutFormatted && (
              <Row label="At least">
                {chain.quote.minAmountOutFormatted} {chain.asset.symbol}
              </Row>
            )}
            <Row label="Fees">In the price. Gas is on us.</Row>
            <Row label="Arrives">{inAbout(chain.quote.timeEstimate)}</Row>
          </>
        ) : (
          <>
            <Row label="To" mono icon={isNear ? <ChainLogo blockchain="near" name="NEAR" size={16} /> : undefined}>
              {address}
            </Row>
            <Row label={isNear ? "Network fee" : "Fee"}>{isNear ? "Paid by Selkie" : "None. We cover it."}</Row>
            <Row label="Arrives">In a few seconds</Row>
          </>
        )}

        {(chain || (paid && payout)) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[rgba(233,241,236,.06)] px-4 py-3">
            <Fresh at={chain?.at ?? payout!.at} every={30} loading={chain?.loading ?? payout!.loading} />
            {paid && !paid.payoutsOn && (
              <span className="co-hint inline-flex items-center gap-1.5">
                <Eye size={13} /> {previewLabel(paid)}
              </span>
            )}
          </div>
        )}
      </div>

      {paid && !paid.payoutsOn && (
        <div className="mt-4">
          <Note tone="info" icon={<Eye size={15} />}>
            <b>Preview only.</b>{" "}
            {paid.note ?? "The banks, the rate and the name on the account are real, but nothing is sent."}
          </Note>
        </div>
      )}

      {toBank && !paid && (
        <p className="co-hint mt-3">
          The rate and the fee appear here the moment your bank is connected, and you will always see them before
          anything moves.
        </p>
      )}

      {contract && (
        <div className="mt-4">
          <ContractNotice accountId={address} accepted={contract.accepted} onAccept={contract.onAccept} />
        </div>
      )}

      {chain?.quote.preview && <PreviewNote what="nothing leaves your account from here. Cash out to a NEAR account in the meantime." />}

      {(error ?? stop) && (
        <p className="co-error mt-4 text-center" role="alert">
          {error ?? stop}
        </p>
      )}

      <button type="button" className="co-btn mt-6" onClick={onConfirm} disabled={blocked}>
        {sending ? (
          <>
            <Loader2 size={16} className="co-spin" /> Sending
          </>
        ) : preview ? (
          paid?.live ? "Bank payouts aren't on yet" : "Sending works on mainnet"
        ) : live ? (
          <>
            <PenLine size={16} strokeWidth={2.4} /> Sign and send
          </>
        ) : toBank ? (
          "Send to my bank"
        ) : (
          "Send to my wallet"
        )}
      </button>
      {live && !preview && <p className="co-hint mt-2.5 text-center">Signed with your own key. Selkie pays the network fee.</p>}
      <button type="button" className="co-ghost mt-3" onClick={onBack} disabled={sending}>
        Change something
      </button>
    </>
  );
}
