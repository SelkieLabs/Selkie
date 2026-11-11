/**
 * Paying people from a DAO treasury by X handle (Sputnik DAO, v2 and v3).
 *
 * A community decides to pay five contributors. It knows their X handles, not
 * their NEAR accounts, and two of them have never used NEAR. The DAO votes on
 * one proposal: a single USDC `ft_transfer_call` to the escrow carrying a
 * `hold_many` msg, one item per person. When it executes, each amount waits
 * under that person's recipient key until they sign in to Selkie with X.
 *
 * Everyone goes through the escrow, Selkie users included. The API checks for
 * waiting money on every signed-in request and the oracle releases it, so a
 * Selkie user has it within seconds of opening the app. Paying them directly
 * would need the DAO to know who is on Selkie today, and a proposal is voted
 * on for days: by the time it executes, that list may be wrong.
 *
 * Pure: no network. `scripts/dao-payout.ts` does the reading and signing.
 */
import { USDC_DECIMALS, fromBaseUnits, toPositiveBaseUnits, AmountError } from "./amounts";
import { fromBase64, toBase64 } from "./delegate";
import { MAX_HOLD_MANY_ITEMS, MIN_HOLD_UNITS, TGAS, holdManyTransfer } from "./escrow";

/** X's own rule for a username. */
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

export interface PayoutRow {
  /** Lowercase, no @. */
  handle: string;
  /** USDC base units. */
  units: bigint;
  /** 1-based line in the CSV, for error messages. */
  line: number;
}

export class PayoutError extends Error {}

/**
 * Read `@handle,amount` lines. Blank lines, `#` comments and a header line are
 * skipped. Every problem is reported at once, with its line number, because
 * whoever wrote the file wants to fix it in one pass, not five.
 */
export function parsePayoutCsv(text: string): PayoutRow[] {
  const rows: PayoutRow[] = [];
  const problems: string[] = [];
  const seen = new Map<string, number>();

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const content = raw.replace(/#.*$/, "").trim();
    if (!content) return;
    const [rawHandle = "", rawAmount = "", ...rest] = content.split(",").map((cell) => cell.trim());
    if (rows.length === 0 && problems.length === 0 && /^handle$/i.test(rawHandle.replace(/^@/, ""))) return;

    const handle = rawHandle.replace(/^@+/, "").toLowerCase();
    if (rest.some((cell) => cell !== "")) return void problems.push(`line ${line}: expected "@handle,amount"`);
    if (!X_HANDLE.test(handle)) return void problems.push(`line ${line}: "${rawHandle}" is not an X handle`);

    let units: bigint;
    try {
      units = toPositiveBaseUnits(rawAmount, USDC_DECIMALS);
    } catch (error) {
      const why = error instanceof AmountError ? error.message : `not an amount: "${rawAmount}"`;
      return void problems.push(`line ${line}: @${handle}: ${why}`);
    }
    if (units < MIN_HOLD_UNITS) {
      return void problems.push(
        `line ${line}: @${handle} gets ${rawAmount}; the escrow holds at least ${fromBaseUnits(MIN_HOLD_UNITS)} USDC`,
      );
    }

    const first = seen.get(handle);
    if (first !== undefined) return void problems.push(`line ${line}: @${handle} is already on line ${first}`);
    seen.set(handle, line);
    rows.push({ handle, units, line });
  });

  if (rows.length === 0 && problems.length === 0) problems.push("nobody to pay: the file has no @handle,amount lines");
  if (rows.length > MAX_HOLD_MANY_ITEMS) {
    problems.push(`${rows.length} people; one proposal pays at most ${MAX_HOLD_MANY_ITEMS}. Split the file.`);
  }
  if (problems.length > 0) throw new PayoutError(problems.join("\n"));
  return rows;
}

/** One action of a Sputnik FunctionCall proposal. Args are base64 JSON; numbers are strings. */
export interface SputnikActionCall {
  method_name: string;
  args: string;
  deposit: string;
  gas: string;
}

export interface SputnikProposalInput {
  description: string;
  kind: { FunctionCall: { receiver_id: string; actions: SputnikActionCall[] } };
}

export interface PayoutRecipient {
  handle: string;
  units: bigint;
  /** 64-hex recipient key (recipient.ts). */
  recipient: string;
}

/**
 * Gas for the vote that executes a payout. The proposal's one action asks for
 * 300 Tgas (a 40-item hold_many fits in it), and the DAO needs its own share
 * for `act_proposal` and for the callback that marks the proposal done.
 */
export const PAYOUT_EXECUTE_GAS = 400n * TGAS;

/** The proposal a DAO votes on to pay these people by X handle. */
export function payoutProposal(input: {
  usdc: string;
  escrow: string;
  people: PayoutRecipient[];
  lifetimeSecs: number;
  /** Shown in the DAO's UI above the generated summary. */
  title?: string;
}): SputnikProposalInput {
  if (input.people.length === 0) throw new PayoutError("nobody to pay");
  const call = holdManyTransfer(input.usdc, input.escrow, {
    items: input.people.map((person) => ({ recipient: person.recipient, amount: person.units.toString() })),
    lifetimeSecs: input.lifetimeSecs,
    memo: "Selkie payout",
  });
  const total = input.people.reduce((sum, person) => sum + person.units, 0n);
  const days = Math.round(input.lifetimeSecs / 86_400);
  const lines = input.people.map((person) => `@${person.handle} ${fromBaseUnits(person.units)}`).join(", ");
  const description = [
    `${input.title ?? `Pay ${input.people.length} people by X handle with Selkie`}.`,
    `${fromBaseUnits(total)} USDC in all: ${lines}.`,
    `Each amount waits in ${input.escrow} until that person signs in to Selkie with X.`,
    `Unclaimed after ${days} days, the DAO can take it back with escrow.refund.`,
  ].join(" ");

  return {
    description,
    kind: {
      FunctionCall: {
        receiver_id: call.receiverId,
        actions: call.calls.map((prepared) => ({
          method_name: prepared.methodName,
          args: toBase64(new TextEncoder().encode(prepared.argsJson)),
          deposit: prepared.deposit,
          gas: prepared.gas,
        })),
      },
    },
  };
}

/** The proposal's total in USDC base units, read back from its own action. For checks before signing. */
export function proposalTotal(proposal: SputnikProposalInput): bigint {
  const [action] = proposal.kind.FunctionCall.actions;
  if (!action) return 0n;
  const args = JSON.parse(new TextDecoder().decode(fromBase64(action.args))) as { amount: string };
  return BigInt(args.amount);
}
