"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Shown before paying an account that runs a contract. Plain words, and a box
 * to tick: a staking pool will accept USDC and never give it back, and the
 * person paying should have to say they know that.
 */
export function ContractWarning({
  accountId,
  accepted,
  onAccept,
}: {
  accountId: string;
  accepted: boolean;
  onAccept: (accepted: boolean) => void;
}) {
  return (
    <div
      role="alert"
      className="mt-5 w-full max-w-md rounded-xl bg-[#f28b9b]/[0.07] p-3.5 text-left text-[14px] leading-relaxed text-pen/75"
    >
      <p className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#f28b9b]" />
        <span>
          <strong className="text-pen">This is a smart contract, not a wallet.</strong> Most contracts,
          staking pools for one, cannot send USDC back out, so money sent to{" "}
          <span className="break-all font-mono text-[12.5px]">{accountId}</span> can be stuck for good.
        </span>
      </p>
      <label className="mt-3 flex cursor-pointer items-start gap-2.5 font-semibold text-pen/85">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => onAccept(e.target.checked)}
          className="mt-[3px] h-4 w-4 shrink-0 accent-[#f28b9b]"
        />
        <span>I know this contract accepts USDC. Pay it anyway.</span>
      </label>
    </div>
  );
}
