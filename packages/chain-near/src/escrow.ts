/**
 * The handle-escrow contract, as the rest of Selkie sees it: the calls a user
 * signs to pay or take money back, the views, and the events it emits.
 *
 * Money reaches the escrow only through NEP-141 `ft_transfer_call`, so a "hold"
 * is a call on the USDC contract whose `msg` the escrow parses. A bad msg is not
 * an error the user eats: the escrow returns the amount and the token refunds it.
 */
import { ONE_YOCTO } from "./amounts";
import { preparedCall, type PreparedCall } from "./delegate";

export const TGAS = 1_000_000_000_000n;
export const GAS = {
  ftTransfer: 30n * TGAS,
  // ft_transfer_call runs the escrow's ft_on_transfer and the token's resolve
  // step on the same budget; 100 Tgas leaves both comfortable headroom.
  ftTransferCall: 100n * TGAS,
  // refund = remove + ft_transfer (15) + callback (15) on the escrow's side.
  refund: 60n * TGAS,
  claim: 100n * TGAS,
  storageDeposit: 30n * TGAS,
} as const;

/** Nothing a user signs through the relayer may ask for more than this. */
export const MAX_RELAYED_GAS = 150n * TGAS;

export interface PaymentView {
  id: string;
  sender: string;
  token: string;
  /** Base units, decimal string. */
  amount: string;
  /** 64-hex recipient key. */
  recipient: string;
  /** Unix nanoseconds after which the sender may refund, decimal string. */
  expiry_ns: string;
}

export interface HoldItem {
  recipient: string;
  /** Base units, decimal string. */
  amount: string;
}

export interface Call {
  receiverId: string;
  calls: PreparedCall[];
}

/** Pay someone who already has a Selkie account: straight into it. */
export function directTransfer(usdc: string, input: { to: string; amount: string; memo?: string }): Call {
  return {
    receiverId: usdc,
    calls: [
      preparedCall(
        "ft_transfer",
        { receiver_id: input.to, amount: input.amount, ...(input.memo ? { memo: input.memo } : {}) },
        GAS.ftTransfer,
        ONE_YOCTO,
      ),
    ],
  };
}

/** Pay a handle that has not signed in yet: the money waits in the escrow. */
export function holdTransfer(
  usdc: string,
  escrow: string,
  input: { amount: string; recipient: string; lifetimeSecs: number; memo?: string },
): Call {
  const msg = JSON.stringify({ kind: "hold", recipient: input.recipient, lifetime_secs: input.lifetimeSecs });
  return transferCall(usdc, escrow, input.amount, msg, input.memo);
}

/** Pay many handles in one signature; the escrow checks the items sum to the amount. */
export function holdManyTransfer(
  usdc: string,
  escrow: string,
  input: { items: HoldItem[]; lifetimeSecs: number; memo?: string },
): Call {
  const total = input.items.reduce((sum, item) => sum + BigInt(item.amount), 0n);
  const msg = JSON.stringify({ kind: "hold_many", lifetime_secs: input.lifetimeSecs, items: input.items });
  return transferCall(usdc, escrow, total.toString(), msg, input.memo);
}

/** Take back a payment nobody claimed. Only its sender, only after expiry. */
export function refundCall(escrow: string, id: string): Call {
  return { receiverId: escrow, calls: [preparedCall("refund", { id }, GAS.refund, 0n)] };
}

function transferCall(usdc: string, escrow: string, amount: string, msg: string, memo?: string): Call {
  return {
    receiverId: usdc,
    calls: [
      preparedCall(
        "ft_transfer_call",
        { receiver_id: escrow, amount, ...(memo ? { memo } : {}), msg },
        GAS.ftTransferCall,
        ONE_YOCTO,
      ),
    ],
  };
}

// ---- events ------------------------------------------------------------------

export type EscrowEventName = "hold" | "claim" | "refund" | "claim_failed" | "refund_failed";

export interface EscrowEvent {
  event: EscrowEventName;
  data: Record<string, unknown>[];
}

/** The parts of a transaction outcome this module reads. */
export interface OutcomeLike {
  receipts_outcome: Array<{
    id: string;
    outcome: { executor_id: string; logs: string[]; status: unknown };
  }>;
}

/**
 * The escrow's NEP-297 events in a transaction, in order.
 *
 * Only logs executed BY the escrow count. Any contract can print a line that
 * starts with EVENT_JSON and claims to be us; trusting it would let a token
 * contract invent a payment id that the backend then links to someone's feed.
 */
export function escrowEvents(outcome: OutcomeLike, escrowId: string): EscrowEvent[] {
  const events: EscrowEvent[] = [];
  for (const receipt of outcome.receipts_outcome) {
    if (receipt.outcome.executor_id !== escrowId) continue;
    for (const log of receipt.outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      try {
        const parsed = JSON.parse(log.slice("EVENT_JSON:".length)) as {
          standard?: string;
          event?: EscrowEventName;
          data?: Record<string, unknown>[];
        };
        if (parsed.standard !== "selkie" || !parsed.event) continue;
        events.push({ event: parsed.event, data: parsed.data ?? [] });
      } catch {
        // Not ours, or not JSON: ignore rather than fail a payment over a log line.
      }
    }
  }
  return events;
}

/** The first receipt that failed, as a short reason, or null if everything ran. */
export function firstFailure(outcome: OutcomeLike): string | null {
  for (const receipt of outcome.receipts_outcome) {
    const status = receipt.outcome.status as { Failure?: unknown } | undefined;
    if (status && typeof status === "object" && "Failure" in status) {
      return `${receipt.outcome.executor_id}: ${JSON.stringify(status.Failure).slice(0, 300)}`;
    }
  }
  return null;
}
