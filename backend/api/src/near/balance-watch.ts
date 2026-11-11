import { USDC_DECIMALS, fromBaseUnits } from "@selkie/chain-near";
import type { ActivityStore } from "../activity/store";
import type { NearAccountStore } from "./store";

/** How the feed names money that moved without Selkie doing it. */
export const OUTSIDE = "outside Selkie";

export interface BalanceWatchDeps {
  accounts: NearAccountStore;
  activity: ActivityStore;
  /** How long a difference must hold before it is written down. */
  settleAfterMs?: number;
  now?: () => number;
}

/**
 * Notices money that reached a NEAR account without going through Selkie.
 *
 * A handle account is a real NEAR account, so anyone can pay it: the Circle
 * faucet, an exchange withdrawal, a friend's wallet. Selkie writes the feed when
 * it moves money itself, so those arrivals used to raise the balance with no
 * line saying why, and nothing told the person that money had come in.
 *
 * Selkie keeps, per account, the balance it expects (`seen_usdc`): every send,
 * claim and refund it records moves that number by the same amount. Whenever
 * the balance is read, whatever the chain shows beyond it came from outside and
 * gets one line in the feed.
 *
 * The chain and the expected number do not move at the same instant: a payment
 * lands on chain a moment before Selkie records it, and RPC nodes can lag a
 * block or two behind each other. So a difference is only written down once it
 * has held, unchanged, for `settleAfterMs`, and never while a payment through
 * Selkie is in flight for that account. A wrong line in someone's money history
 * is worse than one that shows up ten seconds late.
 *
 * State for the in-flight and settling checks lives in this process. With more
 * than one API process a difference may take one extra poll to settle; it can
 * never be written twice, because writing it moves `seen_usdc` past it.
 */
export class BalanceWatch {
  readonly #settleAfterMs: number;
  readonly #now: () => number;
  /** accountId -> a difference waiting to prove it is real. */
  readonly #pending = new Map<string, { delta: bigint; since: number }>();
  /** accountId -> how many Selkie payments touching it are in flight. */
  readonly #busy = new Map<string, number>();
  readonly #checking = new Set<string>();

  constructor(private readonly deps: BalanceWatchDeps) {
    this.#settleAfterMs = deps.settleAfterMs ?? 10_000;
    this.#now = deps.now ?? Date.now;
  }

  /**
   * Run a payment through Selkie. While it runs, its accounts' balances are
   * expected to disagree with the books, so nobody calls that "outside".
   */
  async around<T>(accountIds: string[], work: () => Promise<T>): Promise<T> {
    const ids = [...new Set(accountIds)];
    for (const id of ids) this.#busy.set(id, (this.#busy.get(id) ?? 0) + 1);
    try {
      return await work();
    } finally {
      for (const id of ids) {
        const left = (this.#busy.get(id) ?? 1) - 1;
        if (left > 0) this.#busy.set(id, left);
        else this.#busy.delete(id);
        // Whatever was settling started before this payment; measure again.
        this.#pending.delete(id);
      }
    }
  }

  /** Selkie just recorded money moving in (+) or out (-) of this account. */
  async expect(accountId: string, delta: bigint): Promise<void> {
    if (delta !== 0n) await this.deps.accounts.addSeenUsdc(accountId, delta);
  }

  /**
   * Compare the balance just read off the chain with the books. Writes at most
   * one feed line, and returns it so a caller could say something.
   */
  async check(user: { id: string; address: string }, onchain: bigint): Promise<"recorded" | "quiet"> {
    const accountId = user.address;
    if (this.#busy.has(accountId) || this.#checking.has(accountId)) return "quiet";
    this.#checking.add(accountId);
    try {
      let seen = await this.deps.accounts.seenUsdc(accountId);
      if (seen === null) {
        // An account opened before Selkie kept count. If its feed is empty, all
        // of its balance came from outside (a faucet, usually), so start at zero
        // and let it show up. If it has history, the feed already explains some
        // of the balance and we cannot tell which part, so start from now.
        const history = await this.deps.activity.list(user.id, { limit: 1 });
        await this.deps.accounts.startSeenUsdc(accountId, history.length === 0 ? 0n : onchain);
        seen = await this.deps.accounts.seenUsdc(accountId);
        if (seen === null) return "quiet";
      }

      const delta = onchain - seen;
      if (delta === 0n) {
        this.#pending.delete(accountId);
        return "quiet";
      }
      const now = this.#now();
      const waiting = this.#pending.get(accountId);
      if (!waiting || waiting.delta !== delta) {
        this.#pending.set(accountId, { delta, since: now });
        return "quiet";
      }
      if (now - waiting.since < this.#settleAfterMs) return "quiet";

      this.#pending.delete(accountId);
      // Books first: if writing the line fails, the worst case is a missing
      // line, never the same deposit announced twice.
      await this.deps.accounts.addSeenUsdc(accountId, delta);
      const incoming = delta > 0n;
      await this.deps.activity.record(user.id, {
        kind: incoming ? "receive" : "send",
        chain: "near",
        amount: { amount: fromBaseUnits(incoming ? delta : -delta, USDC_DECIMALS), asset: "USDC" },
        counterparty: OUTSIDE,
        status: "confirmed",
      });
      return "recorded";
    } finally {
      this.#checking.delete(accountId);
    }
  }
}
