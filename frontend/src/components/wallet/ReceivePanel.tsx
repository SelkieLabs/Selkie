"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Droplets, ExternalLink, Loader2 } from "lucide-react";
import { TokenIcon } from "@/components/TokenIcon";
import { ChainLogo } from "@/components/ChainLogo";
import { AddressCode, CopyButton } from "@/components/wallet/AddressBits";
import { AddFromChain } from "@/components/wallet/OtherChain";
import { Panel, PanelHead } from "@/components/wallet/Panel";
import { ApiError, api, type ReceiveDetails } from "@/lib/api";
import { NEAR_NETWORK, isNear } from "@/lib/chain";
import { ASSET_LABEL } from "@/lib/format";

/** The words that differ by chain. The screen is the same; what it points at is not. */
const COPY = isNear
  ? {
      blurb:
        "Send USDC on NEAR to this account name from any NEAR wallet or exchange. It is your own account, named after your X handle.",
      readying: "Getting your account ready",
      readyingWhy:
        "This happens once. We are registering your account to hold USDC, and paying for it so you never have to.",
      label: "Your NEAR account",
      copyLabel: "your account name",
      takes: "This account takes",
      warning:
        "Send only USDC, and only on NEAR. Money sent from another chain straight to this name will not arrive: for that, use \"Add money from another chain\" below.",
    }
  : {
      blurb: "Scan this or paste the address into the app you are sending from. It arrives in this wallet.",
      readying: "Getting your address ready",
      readyingWhy:
        "This happens once. We are setting your wallet up to accept money, and paying for it so you never have to.",
      label: "Your address",
      copyLabel: "your address",
      takes: "This address takes",
      warning:
        "Send only what is listed above, and only over Stellar. Anything else sent to this address cannot be recovered by anyone.",
    };

/** Circle's faucet hands out test USDC on NEAR testnet. Mainnet has no faucet. */
const TEST_USDC_FAUCET = isNear && NEAR_NETWORK === "testnet" ? "https://faucet.circle.com" : null;

/**
 * Getting money in.
 *
 * Two doors, and people arrive at different ones. Someone already on Selkie
 * needs nothing but the handle. Someone moving money across from an exchange
 * needs an address, and that address has to be one that can actually receive:
 * asking for it is what makes the wallet real, which is why this screen posts
 * instead of reading.
 */
export function ReceivePanel({ handle }: { handle: string | null }) {
  const [details, setDetails] = useState<ReceiveDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetails(await api.receive());
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "We could not get your address ready. Try again.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      {handle && (
        <Panel className="!bg-gradient-to-b !from-[#fffdf4] !to-[#f6efdd]">
          <PanelHead
            eyebrow="The easy way"
            title="People just need your handle"
            blurb="Anyone can send to this. They do not need your address, and they do not need to ask you for anything."
          />
          <div className="mt-5 flex items-center gap-3 rounded-2xl border-2 border-pen bg-card-bright p-4">
            <span className="min-w-0 flex-1 truncate font-display text-2xl font-bold tracking-tight">
              {handle}
            </span>
            <CopyButton value={handle} label="your handle" className="btn btn-gold btn-sm shrink-0" />
          </div>
        </Panel>
      )}

      <Panel>
        <PanelHead
          eyebrow="From somewhere else"
          title="Move money in from another app"
          blurb={COPY.blurb}
        />

        {error ? (
          <div className="mt-6 rounded-2xl border-2 border-pen/15 bg-pen/[0.04] p-5 text-center">
            <p className="text-[15px] font-semibold text-[#a11d34]">{error}</p>
            <button onClick={() => void load()} className="btn btn-dim btn-sm mx-auto mt-4">
              Try again
            </button>
          </div>
        ) : !details ? (
          <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl border-2 border-pen/15 bg-pen/[0.04] p-8 text-center sm:flex-row sm:text-left">
            <Loader2 size={26} className="shrink-0 animate-spin text-pen/40" />
            <div>
              <p className="font-display text-[17px] font-bold tracking-tight">{COPY.readying}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-pen/60">{COPY.readyingWhy}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
              <AddressCode address={details.address} />

              <div className="min-w-0 flex-1">
                <p className="label flex items-center gap-2">
                  {isNear && <ChainLogo blockchain="near" name="NEAR" size={18} />}
                  {COPY.label}
                </p>
                <p className="mt-2 break-all rounded-xl border-2 border-pen/15 bg-card-bright p-3 font-mono text-[13px] font-medium leading-relaxed text-pen/85">
                  {details.address}
                </p>
                <CopyButton
                  value={details.address}
                  label={COPY.copyLabel}
                  className="btn btn-dark btn-sm mt-3 w-full"
                />
              </div>
            </div>

            {details.accepts.length > 0 && (
              <div className="mt-6">
                <p className="label">{COPY.takes}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {details.accepts.map((asset) => (
                    <span
                      key={asset}
                      className="flex items-center gap-2 rounded-full border-2 border-pen/15 bg-card-bright py-1 pl-1 pr-3.5"
                    >
                      <TokenIcon asset={asset} size={24} />
                      <span className="font-display text-[13px] font-bold">
                        {ASSET_LABEL[asset] ?? asset}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <p className="mt-5 flex items-start gap-2.5 rounded-xl bg-[#a11d34]/[0.07] p-3.5 text-[14px] leading-relaxed text-pen/75">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#a11d34]" />
              <span>{COPY.warning}</span>
            </p>

            {TEST_USDC_FAUCET && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-gold/15 p-3.5 text-[14px] leading-relaxed text-pen/75">
                <Droplets size={16} className="mt-0.5 shrink-0 text-gold-ink" />
                <span>
                  This is NEAR testnet, so the money is test money. Get free test USDC from Circle:
                  pick <b>NEAR Testnet</b>, paste your account name, and it lands here in a minute.{" "}
                  <a
                    href={TEST_USDC_FAUCET}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-bold text-pen underline-offset-2 hover:underline"
                  >
                    Open the faucet <ExternalLink size={12} />
                  </a>
                </span>
              </div>
            )}
          </>
        )}
      </Panel>

      {isNear && <AddFromChain />}
    </div>
  );
}
