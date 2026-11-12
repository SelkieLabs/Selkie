"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, AtSign, Droplets, ExternalLink, Globe, Loader2, Wallet } from "lucide-react";
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
        "Send only USDC, and only on NEAR. Money sent from another chain straight to this name will not arrive: for that, pick \"From another chain\".",
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

type Door = "handle" | "wallet" | "chain";

/**
 * Getting money in.
 *
 * Three doors, and people arrive at different ones. Someone already on Selkie
 * needs nothing but the handle. Someone moving money across from an exchange
 * needs an address, and that address has to be one that can actually receive:
 * asking for it is what makes the wallet real, which is why this screen posts
 * on arrival, whichever door is open. Money on another chain goes through
 * NEAR Intents instead.
 *
 * One door is open at a time. Three sets of instructions on one screen read as
 * three things you have to do; one reads as the one you came for.
 */
export function ReceivePanel({ handle }: { handle: string | null }) {
  const [details, setDetails] = useState<ReceiveDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The address door first: it is the one with the QR and, on testnet, the faucet.
  const [door, setDoor] = useState<Door>("wallet");

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

  const doors: { id: Door; icon: typeof Wallet; title: string; sub: string }[] = [
    {
      id: "wallet",
      icon: Wallet,
      title: isNear ? "From a NEAR wallet" : "From another app",
      sub: isNear ? "USDC on NEAR, to your account name" : "Scan or paste your address",
    },
    ...(handle
      ? [{ id: "handle" as const, icon: AtSign, title: "From someone on Selkie", sub: "They only need your handle" }]
      : []),
    ...(isNear
      ? [{ id: "chain" as const, icon: Globe, title: "From another chain", sub: "Base, Tron and other chains" }]
      : []),
  ];

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHead
          eyebrow="Deposit"
          title="Add money"
          blurb="Pick where it is coming from. Every way lands in the same account."
        />

        {doors.length > 1 && (
          <div
            role="radiogroup"
            aria-label="Where the money is coming from"
            className={`mt-6 grid gap-2 ${doors.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
          >
            {doors.map((d) => {
              const on = d.id === door;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setDoor(d.id)}
                  className={`flex items-center gap-3 rounded-2xl p-3 text-left transition-[background-color,box-shadow] duration-150 sm:flex-col sm:items-start sm:gap-2.5 sm:p-4 ${
                    on
                      ? "bg-sg/[0.08] shadow-[inset_0_0_0_1.5px_rgb(127_209_185/0.55)]"
                      : "bg-tide-0/60 shadow-[inset_0_0_0_1px_rgba(233,241,236,0.08)] hover:bg-pen/[0.04]"
                  }`}
                >
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors duration-150 ${
                      on ? "bg-sg text-abyss" : "bg-tide-2 text-pen/70"
                    }`}
                  >
                    <d.icon size={17} strokeWidth={2} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-semibold">{d.title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-pen/50">{d.sub}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div key={door} className="step-in">
          {door === "handle" && handle && (
            <div className="mt-6">
              <p className="text-[15px] leading-relaxed text-pen/60">
                Anyone can send to this. They do not need your address, and they do not need to ask
                you for anything.
              </p>
              <div className="mt-4 flex items-center gap-3 rounded-2xl bg-tide-0 p-4 shadow-[inset_0_0_0_1px_rgba(233,241,236,0.08)]">
                <span className="min-w-0 flex-1 truncate font-display text-2xl font-extrabold tracking-[-0.03em]">
                  {handle}
                </span>
                <CopyButton value={handle} label="your handle" className="btn btn-gold btn-sm shrink-0" />
              </div>
            </div>
          )}

          {door === "wallet" && (
            <>
              <p className="mt-6 text-[15px] leading-relaxed text-pen/60">{COPY.blurb}</p>
              {error ? (
                <div className="mt-5 rounded-2xl bg-[#f28b9b]/[0.07] p-5 text-center">
                  <p className="text-[15px] font-semibold text-[#f28b9b]">{error}</p>
                  <button onClick={() => void load()} className="btn btn-dim btn-sm mx-auto mt-4">
                    Try again
                  </button>
                </div>
              ) : !details ? (
                <div className="mt-5 flex flex-col items-center gap-4 rounded-2xl bg-tide-0/60 p-8 text-center shadow-[inset_0_0_0_1px_rgba(233,241,236,0.06)] sm:flex-row sm:text-left">
                  <Loader2 size={24} className="shrink-0 animate-spin text-sg" />
                  <div>
                    <p className="font-display text-[17px] font-bold tracking-tight">{COPY.readying}</p>
                    <p className="mt-1 text-[14px] leading-relaxed text-pen/60">{COPY.readyingWhy}</p>
                  </div>
                </div>
              ) : (
                <WalletDoor details={details} />
              )}
            </>
          )}

          {door === "chain" && (
            <p className="mt-5 text-[14px] text-pen/50">Through NEAR Intents. The steps are just below.</p>
          )}
        </div>
      </Panel>

      {door === "chain" && isNear && <AddFromChain />}
    </div>
  );
}

/** The address door, once the account is ready to receive. */
function WalletDoor({ details }: { details: ReceiveDetails }) {
  return (
    <>
      <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <AddressCode address={details.address} />

        <div className="w-full min-w-0 flex-1">
          <p className="label flex items-center gap-2">
            {isNear && <ChainLogo blockchain="near" name="NEAR" size={18} />}
            {COPY.label}
          </p>
          <p className="mt-2 break-all rounded-xl bg-tide-0 p-3 font-mono text-[13px] leading-relaxed text-pen/85 shadow-[inset_0_0_0_1px_rgba(233,241,236,0.08)]">
            {details.address}
          </p>
          <CopyButton value={details.address} label={COPY.copyLabel} className="btn btn-dark btn-sm mt-3 w-full" />
        </div>
      </div>

      {details.accepts.length > 0 && (
        <div className="mt-6">
          <p className="label">{COPY.takes}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {details.accepts.map((asset) => (
              <span
                key={asset}
                className="flex items-center gap-2 rounded-full bg-tide-2 py-1 pl-1 pr-3.5 shadow-[inset_0_0_0_1px_rgba(233,241,236,0.08)]"
              >
                <TokenIcon asset={asset} size={24} />
                <span className="text-[13px] font-semibold">{ASSET_LABEL[asset] ?? asset}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mt-5 flex items-start gap-2.5 rounded-xl bg-[#f28b9b]/[0.07] p-3.5 text-[14px] leading-relaxed text-pen/75">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#f28b9b]" />
        <span>{COPY.warning}</span>
      </p>

      {TEST_USDC_FAUCET && (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-sg/[0.08] p-3.5 text-[14px] leading-relaxed text-pen/75">
          <Droplets size={16} className="mt-0.5 shrink-0 text-sg" />
          <span>
            This is NEAR testnet, so the money is test money. Get free test USDC from Circle: pick{" "}
            <b className="text-pen">NEAR Testnet</b>, paste your account name, and it lands here in a
            minute.{" "}
            <a
              href={TEST_USDC_FAUCET}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-sg underline-offset-2 hover:underline"
            >
              Open the faucet <ExternalLink size={12} />
            </a>
          </span>
        </div>
      )}
    </>
  );
}
