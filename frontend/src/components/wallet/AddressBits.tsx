"use client";

import { useEffect, useState } from "react";
import { Check, Copy, QrCode } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";

/** Copy that says it worked, because a silent copy is indistinguishable from a broken one. */
export function CopyButton({
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
      toast(
        "error",
        `Your browser would not let us copy that. Press and hold ${label} to copy it by hand.`,
      );
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
export function AddressCode({
  address,
  alt = "Your wallet address as a scannable code",
}: {
  address: string;
  alt?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void import("qrcode")
      .then((qrcode) =>
        qrcode.toDataURL(address, {
          margin: 1,
          width: 460,
          errorCorrectionLevel: "M",
          color: { dark: "#07131c", light: "#e9f1ee" },
        }),
      )
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [address]);

  return (
    // Light behind the code even on ink: scanners read dark on light best.
    <div className="grid h-[164px] w-[164px] shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#e9f1ee] p-2">
      {src ? (
        <img src={src} alt={alt} className="h-full w-full" />
      ) : (
        <QrCode size={34} className="text-abyss/30" strokeWidth={1.6} />
      )}
    </div>
  );
}
