"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, QrCode } from "lucide-react";
import { TokenIcon } from "@/components/TokenIcon";
import { Panel, PanelHead } from "@/components/wallet/Panel";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, api, type ReceiveDetails } from "@/lib/api";
import { ASSET_LABEL } from "@/lib/format";

/** Copy that says it worked, because a silent copy is indistinguishable from a broken one. */
function CopyButton({
  value,
  label,
  className = "btn btn-dim btn-sm",
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast("success", `${label[0]!.toUpperCase()}${label.slice(1)} copied.`);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("error", "Your browser would not let us copy that. Select it and copy by hand.");
    }
  };

  return (
    <button onClick={() => void copy()} className={className} aria-label={`Copy ${label}`}>
      {copied ? <Check size={15} strokeWidth={2.8} /> : <Copy size={15} strokeWidth={2.4} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** The address as a square you can point a phone at. Drawn in the app's own ink. */
function AddressCode({ address }: { address: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void import("qrcode")
      .then((qrcode) =>
        qrcode.toDataURL(address, {
          margin: 1,
          width: 460,
          errorCorrectionLevel: "M",
          color: { dark: "#131a21", light: "#fffdf4" },
        }),
      )
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [address]);

  return (
    <div className="grid h-[164px] w-[164px] shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-pen bg-card-bright p-2">
      {src ? (
        <img src={src} alt="Your wallet address as a scannable code" className="h-full w-full" />
      ) : (
        <QrCode size={34} className="animate-pulse text-pen/25" strokeWidth={1.6} />
      )}
    </div>
  );
}

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
        err instanceof ApiError ? err.message : "We could not get your address ready just now.",
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
          blurb="Scan this or paste the address into the app you are sending from. It arrives in this wallet."
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
              <p className="font-display text-[17px] font-bold tracking-tight">
                Getting your address ready
              </p>
              <p className="mt-1 text-[14px] leading-relaxed text-pen/60">
                This happens once. We are setting your wallet up to accept money, and paying for it
                so you never have to.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
              <AddressCode address={details.address} />

              <div className="min-w-0 flex-1">
                <p className="label">Your address</p>
                <p className="mt-2 break-all rounded-xl border-2 border-pen/15 bg-card-bright p-3 font-mono text-[13px] font-medium leading-relaxed text-pen/85">
                  {details.address}
                </p>
                <CopyButton
                  value={details.address}
                  label="your address"
                  className="btn btn-dark btn-sm mt-3 w-full"
                />
              </div>
            </div>

            {details.accepts.length > 0 && (
              <div className="mt-6">
                <p className="label">This address takes</p>
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
              <span>
                Send only what is listed above, and only over Stellar. Anything else sent to this
                address cannot be recovered by anyone.
              </span>
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}
