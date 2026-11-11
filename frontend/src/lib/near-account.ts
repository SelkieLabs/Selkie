"use client";

import { useCallback, useState } from "react";
import { ApiError, api, type AccountLookup } from "@/lib/api";

/**
 * Checks a NEAR account before money goes to it.
 *
 * The case it exists for: a pasted name that turns out to be a contract. A
 * staking pool or a DAO will take USDC and has no way to give it back, so the
 * person paying gets told, and has to say they know, before anything moves.
 *
 * The server asks the same question when it prepares the payment. That copy is
 * the one that cannot be skipped; this one is here so the warning shows on the
 * confirm screen instead of as an error after pressing Send.
 */
export function useAccountCheck() {
  const [info, setInfo] = useState<AccountLookup | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [checking, setChecking] = useState(false);

  /** Look the account up. Returns what to tell the user, or null to go on. */
  const check = useCallback(async (accountId: string): Promise<string | null> => {
    setChecking(true);
    setAccepted(false);
    try {
      const found = await api.near.account(accountId);
      setInfo(found);
      if (found.kind === "missing") return `There is no NEAR account called ${accountId}. Check the name.`;
      if (found.isYou) return "That's your own account. Pick another one.";
      return null;
    } catch (err) {
      setInfo(null);
      // A bad name is worth saying now. Anything else (the network, a busy
      // RPC) is not a reason to block: preparing the payment checks again.
      return err instanceof ApiError && err.status === 400 ? err.message : null;
    } finally {
      setChecking(false);
    }
  }, []);

  /**
   * The server refused because the account is a contract (the lookup failed
   * earlier, or the account changed since). Turn that into the warning.
   */
  const fromRefusal = useCallback((err: unknown): boolean => {
    if (!(err instanceof ApiError) || err.body?.code !== "contract_account") return false;
    const accountId = String(err.body.account ?? "");
    setInfo({ accountId, kind: "contract", onSelkie: false, isYou: false, warning: err.message });
    setAccepted(false);
    return true;
  }, []);

  const reset = useCallback(() => {
    setInfo(null);
    setAccepted(false);
  }, []);

  const isContract = info?.kind === "contract";
  return {
    info,
    isContract,
    accepted,
    setAccepted,
    checking,
    check,
    fromRefusal,
    reset,
    /** Send stays off until a contract warning has been accepted. */
    blocked: isContract && !accepted,
    /** What to pass to prepareTransfer. */
    toContract: isContract && accepted ? true : undefined,
  };
}
