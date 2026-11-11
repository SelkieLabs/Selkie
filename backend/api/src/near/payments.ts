/**
 * What a NEAR payment is, before and after the user's key signs it.
 *
 * `plan` turns a request from the web app into the exact call to sign and a
 * PaymentIntent that says what it means. `settle` reads the chain's outcome
 * once the relayer has submitted it and writes the feed for everyone involved.
 * Nothing here signs anything: on NEAR only the user's own key moves money.
 */
import type { HandleRef, Money } from "@selkie/core";
import { handleKey } from "@selkie/core";
import {
  MAX_PAY_MANY,
  USDC_DECIMALS,
  directTransfer,
  fromBaseUnits,
  holdTransfer,
  isValidAccountId,
  payManyCall,
  recipientKeyFor,
  refundCall,
  toBaseUnits,
  toPositiveBaseUnits,
  type Call,
  type NearChain,
  type TxOutcome,
} from "@selkie/chain-near";
import { toHandle } from "../app";
import type { ActivityStore, NewActivity } from "../activity/store";
import type { IdentityService } from "../identity/service";
import type { UserStore } from "../identity/store";
import type { User } from "../identity/types";
import { userHandles } from "../identity/types";
import type { RequestStore } from "../requests/store";
import type { BalanceWatch } from "./balance-watch";
import { Refusal } from "./refusal";
import type { ManyItem, NearAccountStore, PaymentIntent } from "./store";
import type { XUserLookup } from "./x-lookup";

const NOTE_MAX = 120;

export interface PrepareBody {
  /** A handle to pay. */
  to?: string;
  /** A NEAR account to pay instead of a handle. */
  toAccount?: string;
  /** Several handles, the same amount each. */
  toMany?: string[];
  /** Pay this request, for the amount it asked. */
  requestId?: string;
  /** Take back this expired, unclaimed payment. */
  refundId?: string | number;
  amount?: string;
  note?: string;
  /** How a transfer to an account shows in the feed: a send, or money cashed out. */
  purpose?: "send" | "cashout";
}

export interface PaymentPlan {
  call: Call;
  intent: PaymentIntent;
}

/** What the relay route answers once the chain has spoken. */
export interface Settled {
  status: "confirmed" | "pending" | "returned" | "done";
  ref: string;
  explorer: string;
  message: string;
  waitingToBeClaimed: boolean;
  claimRef?: string;
  results?: { handle: string; sent: boolean; waitingToBeClaimed?: boolean }[];
}

export interface NearPaymentsDeps {
  chain: NearChain;
  identity: IdentityService;
  users: UserStore;
  accounts: NearAccountStore;
  activity: ActivityStore;
  requests: RequestStore;
  /** Told about every balance Selkie moves, so it can tell those from outside money. */
  watch: BalanceWatch;
  xLookup: XUserLookup;
}

export class NearPayments {
  constructor(private readonly deps: NearPaymentsDeps) {}

  private get config() {
    return this.deps.chain.config;
  }

  // ---- before signing ------------------------------------------------------

  async plan(user: User, body: PrepareBody): Promise<PaymentPlan> {
    if (body.refundId !== undefined) return this.planRefund(user, String(body.refundId));
    if (body.requestId !== undefined) return this.planRequest(user, String(body.requestId));
    if (body.toMany !== undefined) return this.planMany(user, body);
    if (body.toAccount !== undefined) return this.planTransfer(user, body);
    return this.planSend(user, body);
  }

  /**
   * Checked again right before relaying, because a request can be paid from two
   * tabs: both prepares are valid, but only the first may go through.
   */
  async stillWanted(intent: PaymentIntent): Promise<void> {
    if ((intent.kind === "send" || intent.kind === "hold") && intent.requestId) {
      const request = await this.deps.requests.get(intent.requestId);
      if (!request || request.status !== "pending") throw new Refusal(409, "That request has already been answered.");
    }
  }

  /** One handle: straight into their account if they have one, into the escrow if not. */
  private async planSend(user: User, body: PrepareBody, requestId?: string): Promise<PaymentPlan> {
    const to = body.to ? toHandle(body.to, "x") : null;
    if (!to) throw new Refusal(400, "Add the handle you want to pay.");
    if (owns(user, to)) throw new Refusal(400, "That's you. Pick someone else to pay.");
    const units = toPositiveBaseUnits(String(body.amount ?? ""), USDC_DECIMALS);
    await this.ensureBalance(user, units);
    const amount = usdc(units);
    const memo = cleanNote(body.note);

    const recipient = await this.deps.identity.findByHandle("x", to.username);
    if (recipient) {
      // Heals an account that somehow missed registration; free when it did not.
      await this.deps.chain.registerForUsdc(recipient.address);
      return {
        call: directTransfer(this.config.usdcContract, { to: recipient.address, amount: units.toString(), memo }),
        intent: { kind: "send", to, amount, recipientAccount: recipient.address, recipientUserId: recipient.id, requestId },
      };
    }
    const key = await this.recipientKey(to);
    return {
      call: holdTransfer(this.config.usdcContract, this.config.escrowContract, {
        amount: units.toString(),
        recipient: key.key,
        lifetimeSecs: this.config.claimLifetimeSecs,
        memo,
      }),
      intent: { kind: "hold", to, amount, recipientKey: key.key, scheme: key.scheme, requestId },
    };
  }

  /** Any NEAR account: a friend's wallet, an exchange deposit, your own other account. */
  private async planTransfer(user: User, body: PrepareBody): Promise<PaymentPlan> {
    const toAccount = String(body.toAccount ?? "").trim().toLowerCase();
    if (!isValidAccountId(toAccount)) {
      throw new Refusal(400, "That is not a NEAR account name. It looks like alice.near, or 64 letters and numbers.");
    }
    if (toAccount === user.address) throw new Refusal(400, "That's your own account. Pick another one.");
    if (toAccount === this.config.usdcContract || toAccount === this.config.escrowContract) {
      throw new Refusal(400, "That is a contract, not somebody's account. Money sent there is lost.");
    }
    const units = toPositiveBaseUnits(String(body.amount ?? ""), USDC_DECIMALS);
    await this.ensureBalance(user, units);
    if (!(await this.deps.chain.accountExists(toAccount))) {
      throw new Refusal(400, `There is no NEAR account called ${toAccount}. Check the name.`);
    }
    // An ft_transfer to an account the token has never seen fails. Selkie pays
    // the small storage fee so the person paying never has to know about it.
    await this.deps.chain.registerForUsdc(toAccount);

    const record = await this.deps.accounts.findByAccountId(toAccount);
    const recipient = record ? await this.deps.users.findByIdentity("x", record.xUserId) : null;
    return {
      call: directTransfer(this.config.usdcContract, { to: toAccount, amount: units.toString(), memo: cleanNote(body.note) }),
      intent: {
        kind: "transfer",
        toAccount,
        amount: usdc(units),
        purpose: body.purpose === "cashout" ? "cashout" : "send",
        recipientUserId: recipient?.id,
      },
    };
  }

  /** Several handles, the same amount each, one signature. */
  private async planMany(user: User, body: PrepareBody): Promise<PaymentPlan> {
    if (!Array.isArray(body.toMany) || body.toMany.length === 0) {
      throw new Refusal(400, "Add some handles and an amount for each person.");
    }
    const seen = new Set(userHandles(user).map(handleKey));
    const targets: HandleRef[] = [];
    for (const raw of body.toMany) {
      const handle = typeof raw === "string" ? toHandle(raw, "x") : null;
      if (!handle || seen.has(handleKey(handle))) continue;
      seen.add(handleKey(handle));
      targets.push(handle);
    }
    if (targets.length === 0) throw new Refusal(400, "None of those handles can be paid. Check them.");
    if (targets.length > MAX_PAY_MANY) {
      throw new Refusal(400, `${MAX_PAY_MANY} people is the most in one go. Send the rest next.`);
    }

    const each = toPositiveBaseUnits(String(body.amount ?? ""), USDC_DECIMALS);
    const total = each * BigInt(targets.length);
    if ((await this.deps.chain.usdcBalance(user.address)) < total) {
      throw new Refusal(
        409,
        `Your balance is too low. ${targets.length} people at $${fromBaseUnits(each, USDC_DECIMALS)} each comes to $${fromBaseUnits(total, USDC_DECIMALS)}.`,
      );
    }

    const items: ManyItem[] = [];
    const direct: { to: string; amount: string }[] = [];
    const holds: { recipient: string; amount: string }[] = [];
    for (const to of targets) {
      const recipient = await this.deps.identity.findByHandle("x", to.username);
      if (recipient) {
        await this.deps.chain.registerForUsdc(recipient.address);
        direct.push({ to: recipient.address, amount: each.toString() });
        items.push({ to, recipientUserId: recipient.id, recipientAccount: recipient.address });
      } else {
        const key = await this.recipientKey(to);
        holds.push({ recipient: key.key, amount: each.toString() });
        items.push({ to, recipientKey: key.key });
      }
    }
    return {
      call: payManyCall(this.config.usdcContract, this.config.escrowContract, {
        direct,
        holds,
        lifetimeSecs: this.config.claimLifetimeSecs,
        memo: cleanNote(body.note),
      }),
      intent: { kind: "many", amount: usdc(each), items },
    };
  }

  /** A request addressed to one of your handles, paid for exactly what it asked. */
  private async planRequest(user: User, id: string): Promise<PaymentPlan> {
    const found = await this.deps.requests.get(id).catch(() => null);
    // Same answer for "does not exist" and "not yours": knowing an id should
    // never tell you a request exists.
    if (!found || !owns(user, found.toHandle)) {
      throw new Refusal(404, "That request is not waiting for you. It may have been withdrawn.");
    }
    if (found.status !== "pending") throw new Refusal(409, "That request has already been answered.");
    if (found.amount.asset !== "USDC") throw new Refusal(409, "That request is not in dollars, so it can't be paid here.");
    return this.planSend(user, { to: found.fromHandle.username, amount: found.amount.amount, note: found.note }, id);
  }

  /** Take back money that waited for someone who never came. */
  private async planRefund(user: User, claimRef: string): Promise<PaymentPlan> {
    if (!/^\d{1,20}$/.test(claimRef)) throw new Refusal(400, "We lost track of that payment.");
    const entry = await this.deps.activity.findByClaimRef(user.id, claimRef);
    const payment = await this.deps.chain.getPayment(claimRef);
    if (!entry || !payment || payment.sender !== user.address) {
      throw new Refusal(409, "That payment was already claimed or returned.");
    }
    const expiresMs = Number(BigInt(payment.expiry_ns) / 1_000_000n);
    if (expiresMs > Date.now()) throw new Refusal(409, `You can take this back ${inWords(expiresMs - Date.now())}.`);
    return {
      call: refundCall(this.config.escrowContract, claimRef),
      intent: { kind: "refund", claimRef, amount: usdc(BigInt(payment.amount)) },
    };
  }

  /** Every account whose USDC balance this payment changes, besides the sender's. */
  accountsTouched(intent: PaymentIntent): string[] {
    switch (intent.kind) {
      case "send":
        return [intent.recipientAccount];
      case "transfer":
        return [intent.toAccount];
      case "many":
        return intent.items.flatMap((item) => (item.recipientAccount ? [item.recipientAccount] : []));
      default:
        return [];
    }
  }

  // ---- after the chain has spoken ------------------------------------------

  async settle(user: User, intent: PaymentIntent, outcome: TxOutcome): Promise<Settled> {
    const ref = outcome.txHash;
    const explorer = this.deps.chain.txUrl(ref);
    const fail = (message: string) => new Refusal(409, message, { ref, explorer });
    if (outcome.failure) throw fail(explainFailure(outcome.failure));
    const from = userHandles(user)[0];
    const holds = outcome.events.filter((event) => event.event === "hold").flatMap((event) => event.data);
    const amount = toBaseUnits(intent.amount.amount, USDC_DECIMALS);
    const { watch } = this.deps;

    switch (intent.kind) {
      case "send": {
        await watch.expect(user.address, -amount);
        await watch.expect(intent.recipientAccount, amount);
        await this.record(user.id, entry("send", intent.amount, "confirmed", ref, handleParty(intent.to)));
        await this.record(intent.recipientUserId, entry("receive", intent.amount, "confirmed", ref, handleParty(from)));
        await this.markRequestPaid(intent.requestId, ref);
        return { status: "confirmed", ref, explorer, waitingToBeClaimed: false, message: `Sent to @${intent.to.username}.` };
      }

      case "hold": {
        const hold = holds[0];
        // No hold event: the escrow refused the msg and the token sent the money back.
        if (!hold) throw fail("Nothing moved. The money is still with you. Try again.");
        await watch.expect(user.address, -amount);
        const waiting = waitingFields(hold);
        await this.record(user.id, { ...entry("send", intent.amount, "pending", ref, handleParty(intent.to)), ...waiting });
        await this.markRequestPaid(intent.requestId, ref);
        return {
          status: "pending",
          ref,
          explorer,
          claimRef: waiting.claimRef,
          waitingToBeClaimed: true,
          message: `Sent. It is waiting for @${intent.to.username} to claim.`,
        };
      }

      case "transfer": {
        const kind = intent.purpose === "cashout" ? "cashout" : "send";
        await watch.expect(user.address, -amount);
        // A no-op unless the account is a Selkie one.
        await watch.expect(intent.toAccount, amount);
        await this.record(user.id, entry(kind, intent.amount, "confirmed", ref, { counterparty: intent.toAccount }));
        if (intent.recipientUserId) {
          await this.record(intent.recipientUserId, entry("receive", intent.amount, "confirmed", ref, handleParty(from)));
        }
        return {
          status: "confirmed",
          ref,
          explorer,
          waitingToBeClaimed: false,
          message: `Sent to ${intent.toAccount}.`,
        };
      }

      case "many": {
        const results: NonNullable<Settled["results"]> = [];
        for (const item of intent.items) {
          const handle = `@${item.to.username}`;
          if (item.recipientUserId) {
            await watch.expect(user.address, -amount);
            if (item.recipientAccount) await watch.expect(item.recipientAccount, amount);
            await this.record(user.id, entry("send", intent.amount, "confirmed", ref, handleParty(item.to)));
            await this.record(item.recipientUserId, entry("receive", intent.amount, "confirmed", ref, handleParty(from)));
            results.push({ handle, sent: true, waitingToBeClaimed: false });
            continue;
          }
          const hold = holds.find((data) => data.recipient === item.recipientKey);
          if (!hold) {
            results.push({ handle, sent: false });
            continue;
          }
          await watch.expect(user.address, -amount);
          await this.record(user.id, {
            ...entry("send", intent.amount, "pending", ref, handleParty(item.to)),
            ...waitingFields(hold),
          });
          results.push({ handle, sent: true, waitingToBeClaimed: true });
        }
        const sent = results.filter((result) => result.sent).length;
        if (sent === 0) throw fail("Nothing moved. The money is still with you. Try again.");
        const waiting = results.filter((result) => result.waitingToBeClaimed).length;
        const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
        return {
          status: "done",
          ref,
          explorer,
          results,
          waitingToBeClaimed: waiting > 0,
          message:
            sent < results.length
              ? `Sent to ${sent} of ${results.length}. The rest is still with you.`
              : waiting > 0
                ? `Sent to ${people(sent)}. ${waiting} ${waiting === 1 ? "is" : "are"} waiting for them to sign in.`
                : `Sent to ${people(sent)}.`,
        };
      }

      case "refund": {
        if (!outcome.events.some((event) => event.event === "refund")) {
          throw fail("Nothing moved. Try taking it back again in a moment.");
        }
        await watch.expect(user.address, amount);
        const found = await this.deps.activity.findByClaimRef(user.id, intent.claimRef);
        if (found) await this.deps.activity.settle(user.id, found.id, "returned", ref);
        return { status: "returned", ref, explorer, waitingToBeClaimed: false, message: "It's back in your balance." };
      }
    }
  }

  // ---- helpers ---------------------------------------------------------------

  private async ensureBalance(user: User, units: bigint): Promise<void> {
    if ((await this.deps.chain.usdcBalance(user.address)) < units) {
      throw new Refusal(409, "Your balance is too low. Add money, or send a smaller amount.");
    }
  }

  private async recipientKey(to: HandleRef) {
    return recipientKeyFor({ username: to.username, xUserId: await this.deps.xLookup.idOf(to.username) });
  }

  private async record(userId: string, activity: NewActivity): Promise<void> {
    await this.deps.activity.record(userId, activity);
  }

  private async markRequestPaid(requestId: string | undefined, ref: string): Promise<void> {
    if (requestId) await this.deps.requests.settle(requestId, "paid", ref);
  }
}

function owns(user: User, handle: HandleRef): boolean {
  return userHandles(user).some((mine) => handleKey(mine) === handleKey(handle));
}

function usdc(units: bigint): Money {
  return { amount: fromBaseUnits(units, USDC_DECIMALS), asset: "USDC" };
}

function cleanNote(note: string | undefined): string | undefined {
  return note?.trim().slice(0, NOTE_MAX) || undefined;
}

function entry(
  kind: NewActivity["kind"],
  amount: Money,
  status: "pending" | "confirmed",
  ref: string,
  party: Pick<NewActivity, "counterparty" | "counterpartyHandle">,
): NewActivity {
  return { kind, chain: "near", amount, ...party, status, ref };
}

function handleParty(handle: HandleRef | undefined): Pick<NewActivity, "counterparty" | "counterpartyHandle"> {
  return handle ? { counterparty: `@${handle.username}`, counterpartyHandle: handle } : {};
}

/** The escrow's id for a waiting payment, and when its sender may take it back. */
function waitingFields(hold: Record<string, unknown>) {
  return {
    claimRef: String(hold.id),
    refundableAt: new Date(Number(BigInt(String(hold.expiry_ns)) / 1_000_000n)).toISOString(),
  };
}

/** What a failed receipt means, in words the person can act on. Unknown stays generic. */
export function explainFailure(failure: string): string {
  if (/enough balance|insufficient balance|exceeds balance/i.test(failure)) {
    return "Your balance is too low. Add money, or send a smaller amount.";
  }
  if (/DelegateActionInvalidNonce|InvalidNonce/i.test(failure)) {
    return "That confirmation was already used. Nothing moved. Start again.";
  }
  if (/DelegateActionExpired|Expired/i.test(failure)) return "That took too long to confirm. Nothing moved. Start again.";
  if (/not registered|storage/i.test(failure)) return "Their account is not ready for USDC yet. Nothing moved. Try again.";
  return "The network would not accept that. Nothing moved, so it is safe to try again.";
}

function inWords(ms: number): string {
  const hours = Math.ceil(ms / 3_600_000);
  if (hours <= 1) return "in an hour";
  if (hours < 24) return `in ${hours} hours`;
  const days = Math.ceil(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}
