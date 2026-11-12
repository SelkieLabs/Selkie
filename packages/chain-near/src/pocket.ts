/**
 * The pocket contract, as the rest of Selkie sees it: a small, capped amount of
 * USDC a user parks so a tweet ("@SelkiePay send 2 to @amaka") can pay without
 * a signature at tweet time.
 *
 * The owner tops up, withdraws and changes the daily cap by signing through
 * prepare -> sign -> relay like any other payment. The bot account holds a
 * function-call key that can call `pocket_send` and nothing else, and the
 * contract only lets it pay Selkie handle accounts, up to each owner's daily
 * cap. A stolen bot key can do no more than that.
 *
 * Every amount here is USDC base units as a decimal string ("2000000" = 2 USDC).
 */
import { Account, actions, type JsonRpcProvider, type KeyPairString } from "near-api-js";
import { ONE_YOCTO } from "./amounts";
import { preparedCall } from "./delegate";
import { GAS, TGAS, firstFailure, type Call } from "./escrow";
import { isValidAccountId } from "./names";

/** Daily cap of a pocket topped up without one: 10 USDC. */
export const DEFAULT_POCKET_CAP_UNITS = 10_000_000n;

/**
 * pocket_send runs a 15 Tgas ft_transfer and a 15 Tgas callback that must be
 * able to restore the pocket; 100 Tgas leaves the same headroom as a refund.
 */
const POCKET_SEND_GAS = 100n * TGAS;
/** Withdraw has the same shape as a send: transfer, then a restoring callback. */
const POCKET_WITHDRAW_GAS = 100n * TGAS;
/** set_cap only rewrites one record. */
const POCKET_SET_CAP_GAS = 30n * TGAS;

/** A pocket as `get_pocket` reports it, in base units. */
export interface PocketView {
  balance: string;
  dailyCap: string;
  /** 0 once the UTC day the contract last saw a send has passed. */
  spentToday: string;
  /** What the bot may still send today: the smaller of the balance and the cap left. */
  leftToday: string;
}

/** USDC.ft_transfer_call(pocket, amount, msg {"kind":"top_up", daily_cap?}). */
export function pocketTopUp(usdc: string, pocket: string, input: { amount: string; dailyCap?: string }): Call {
  const amount = positiveUnits(input.amount);
  const msg = JSON.stringify({
    kind: "top_up",
    ...(input.dailyCap !== undefined ? { daily_cap: units(input.dailyCap) } : {}),
  });
  return {
    receiverId: usdc,
    calls: [
      preparedCall("ft_transfer_call", { receiver_id: pocket, amount, msg }, GAS.ftTransferCall, ONE_YOCTO),
    ],
  };
}

/** pocket.pocket_withdraw({amount?}). No amount takes out everything. */
export function pocketWithdraw(pocket: string, input: { amount?: string }): Call {
  const args = input.amount !== undefined ? { amount: positiveUnits(input.amount) } : {};
  return { receiverId: pocket, calls: [preparedCall("pocket_withdraw", args, POCKET_WITHDRAW_GAS, ONE_YOCTO)] };
}

/** pocket.pocket_set_cap({daily_cap}). 0 pauses the bot for this pocket. */
export function pocketSetCap(pocket: string, input: { dailyCap: string }): Call {
  return {
    receiverId: pocket,
    calls: [preparedCall("pocket_set_cap", { daily_cap: units(input.dailyCap) }, POCKET_SET_CAP_GAS, ONE_YOCTO)],
  };
}

/**
 * True for `<label>.<handleParent>`: a direct child of the handle parent, the
 * only accounts the pocket contract lets the bot pay. Mirrors the contract's
 * own check, so the server can refuse before it spends gas finding out.
 */
export function isHandleAccount(accountId: string, handleParent: string): boolean {
  const suffix = `.${handleParent}`;
  if (!accountId.endsWith(suffix)) return false;
  const label = accountId.slice(0, -suffix.length);
  return label.length > 0 && !label.includes(".") && isValidAccountId(accountId);
}

/** The owner's pocket, or null if they never topped one up. */
export async function getPocket(provider: JsonRpcProvider, pocket: string, owner: string): Promise<PocketView | null> {
  const view = (await provider.callFunction({ contractId: pocket, method: "get_pocket", args: { owner } })) as
    | { balance: string; daily_cap: string; spent_today: string; left_today: string }
    | null
    | undefined;
  if (!view) return null;
  return {
    balance: view.balance,
    dailyCap: view.daily_cap,
    spentToday: view.spent_today,
    leftToday: view.left_today,
  };
}

/**
 * Pay `to` from `owner`'s pocket, signed by the bot's function-call key
 * (method pocket_send only). Waits until every receipt, the transfer and the
 * callback, is final.
 *
 * A refused send (over the cap, not a handle account) and a transfer the
 * callback had to undo both come back as `ok: false` with the reason, never as
 * a throw: the caller needs the hash either way. Network errors still throw.
 */
export async function pocketSend(input: {
  provider: JsonRpcProvider;
  pocket: string;
  botAccount: string;
  botKey: KeyPairString;
  owner: string;
  to: string;
  amount: string;
  memo?: string;
}): Promise<{ txHash: string; ok: boolean; failure: string | null }> {
  const args = {
    owner: input.owner,
    to: input.to,
    amount: positiveUnits(input.amount),
    ...(input.memo ? { memo: input.memo } : {}),
  };
  const bot = new Account(input.botAccount, input.provider, input.botKey);
  const result = await bot.signAndSendTransaction({
    receiverId: input.pocket,
    actions: [actions.functionCall("pocket_send", new TextEncoder().encode(JSON.stringify(args)), POCKET_SEND_GAS, 0n)],
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  const failure = firstFailure(result);
  // The callback returns false when it put the money back. That only happens
  // after a failed transfer receipt, which firstFailure already reports; this
  // is the belt to its braces.
  const undone = successValue(result.status) === "false";
  return {
    txHash: result.transaction.hash,
    ok: failure === null && !undone,
    failure: failure ?? (undone ? "the transfer failed and the pocket was restored" : null),
  };
}

/** The decoded return value of a transaction, or null if it has none. */
function successValue(status: unknown): string | null {
  if (!status || typeof status !== "object" || !("SuccessValue" in status)) return null;
  const value = (status as { SuccessValue: unknown }).SuccessValue;
  if (typeof value !== "string") return null;
  return new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
}

/** A non-negative integer of base units, as the contract's U128 wants it. */
function units(value: string): string {
  if (!/^\d+$/.test(value)) throw new Error(`Not an amount in base units: ${JSON.stringify(value)}`);
  return BigInt(value).toString();
}

function positiveUnits(value: string): string {
  const out = units(value);
  if (out === "0") throw new Error("Amount must be more than zero");
  return out;
}
