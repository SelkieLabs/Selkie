import type { HandleRef } from "@selkie/core";
import type { CursorStore, HandleIndex } from "./index-store";

/**
 * Deposits into the escrow, read from the chain rather than guessed at.
 *
 * An interface because the shape that matters is "what turned up since last
 * time, and where did I get to" — the Soroban RPC call behind it is an
 * implementation detail, and stubbing it is how the watcher gets tested without
 * a network.
 */
export interface EscrowEvents {
  depositsSince(cursor: string | null): Promise<DepositBatch>;
}

export interface DepositBatch {
  /** Hex `sha256("<platform>:<username>")`, straight off the event topic. */
  handleHashes: string[];
  /** Where to resume. Stored only after the batch is fully handled. */
  cursor: string;
}

const CURSOR = "escrow-deposits";

/**
 * Money that turns up while you are already using the app.
 *
 * Selkie releases escrowed money when somebody proves they own a handle, which
 * happens at sign-in. But money can arrive a minute later, while they are
 * sitting on the balance screen, and nothing was watching for that: it would
 * appear on their next login, hours later, with no explanation for the delay.
 *
 * The obvious fix is to check on every request, and that is what the code used
 * to do — one contract read per handle per request, plus a payment released by
 * a `GET` and recorded nowhere. This is the version that scales: one RPC call
 * for the whole system, on a timer, reacting to what the contract actually
 * emitted.
 *
 * Deposits for handles nobody has claimed yet are skipped on purpose. That money
 * is waiting for a person who has not arrived, and their sign-in already knows
 * how to collect it.
 */
export class ClaimWatcher {
  #timer: ReturnType<typeof setInterval> | null = null;
  #running = false;

  constructor(
    private readonly deps: {
      events: EscrowEvents;
      index: HandleIndex;
      cursors: CursorStore;
      /** Who owns a handle, if anybody does yet. */
      ownerOf(handle: HandleRef): Promise<{ id: string } | null>;
      /** Release what is waiting and write it down. Both sides. */
      collect(user: { id: string }): Promise<void>;
      onError?(error: unknown): void;
    },
  ) {}

  /**
   * One pass. Returns how many people had money collected for them, which is
   * what the tests assert on and what a log line should say.
   */
  async tick(): Promise<number> {
    const from = await this.deps.cursors.get(CURSOR);
    const batch = await this.deps.events.depositsSince(from);

    // One person can be in a batch twice; collecting once gets all of it.
    const collected = new Set<string>();

    for (const hash of batch.handleHashes) {
      const handle = await this.deps.index.find(hash);
      if (!handle) continue;

      const owner = await this.deps.ownerOf(handle);
      // Nobody has claimed this handle yet, so the money stays where it is and
      // their first sign-in collects it. That is the whole product.
      if (!owner || collected.has(owner.id)) continue;

      collected.add(owner.id);
      await this.deps.collect(owner);
    }

    // Saved last, and only on success. A crash halfway through replays the
    // batch, and collecting twice is harmless: the second pass finds nothing
    // waiting. Saving first would lose the deposits we had not reached.
    await this.deps.cursors.set(CURSOR, batch.cursor);
    return collected.size;
  }

  start(everyMs: number): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.#safeTick(), everyMs);
    // Never hold the process open for a background poll.
    this.#timer.unref?.();
  }

  stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /** Skips a tick rather than stacking them when the chain is slow. */
  async #safeTick(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      await this.tick();
    } catch (error) {
      // A watcher that dies on one bad poll is a watcher that silently stops
      // noticing money. Log and try again on the next tick.
      this.deps.onError?.(error);
    } finally {
      this.#running = false;
    }
  }
}
