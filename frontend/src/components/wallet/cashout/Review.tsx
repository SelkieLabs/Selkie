"use client";

import { Building2, Loader2, PenLine } from "lucide-react";
import { ChainLogo, CoinOnChain } from "@/components/ChainLogo";
import { PreviewNote } from "@/components/wallet/OtherChain";
import type { ChainAsset, IntentsQuote } from "@/lib/api";
import { isNear } from "@/lib/chain";
import { money } from "@/lib/format";
import { assetName, inAbout } from "@/lib/other-chain";
import { ContractNotice, Fresh, Head, Row } from "./bits";
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
  bank: BankDetails;
  country: Country;
  contract?: { accepted: boolean; onAccept: (accepted: boolean) => void };
  sending: boolean;
  error: string | null;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const toBank = destination === "bank";
  const preview = Boolean(chain?.quote.preview);
  const blocked = sending || preview || (contract !== undefined && !contract.accepted);

  return (
    <>
      <Head
        title="Check it, then send"
        blurb={
          chain
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
              <small>You send</small>
              <span className="co-flow-amount">
                {money(amount)}
                <em>USDC</em>
              </span>
            </span>
            {isNear && <CoinOnChain symbol="USDC" blockchain="near" chainName="NEAR" size={34} />}
          </div>
          <span className="co-sink" aria-hidden="true" />
          <div className="co-flow-side co-flow-get">
            <span className="min-w-0">
              <small>{chain ? "They get about" : toBank ? "Your bank pays out" : "Arrives as"}</small>
              <span className="co-flow-amount">
                {chain ? (
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

        {toBank ? (
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

        {chain && (
          <div className="border-t border-[rgba(233,241,236,.06)] px-4 py-3">
            <Fresh at={chain.at} every={30} loading={chain.loading} />
          </div>
        )}
      </div>

      {toBank && (
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

      {preview && <PreviewNote what="nothing leaves your account from here. Cash out to a NEAR account in the meantime." />}

      {error && (
        <p className="co-error mt-4 text-center" role="alert">
          {error}
        </p>
      )}

      <button type="button" className="co-btn mt-6" onClick={onConfirm} disabled={blocked}>
        {sending ? (
          <>
            <Loader2 size={16} className="co-spin" /> Sending
          </>
        ) : preview ? (
          "Sending works on mainnet"
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
