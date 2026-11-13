/**
 * The X pocket, server side: a small, capped amount of USDC a person parks in
 * the pocket contract so a tweet ("@SelkiePay send 2 to @amaka") can pay with
 * no signature at tweet time.
 *
 * Two halves, with different trust:
 *
 *  - The owner's half (top up, withdraw, change the daily limit) is signed by
 *    their own key through prepare -> sign -> relay, like every other payment
 *    (payments.ts plans it). The relayer pays gas for `pocket_withdraw` and
 *    `pocket_set_cap` and nothing else on the pocket contract.
 *  - The bot's half is `POST /near/bot/send`, gated by SELKIE_BOT_SECRET. The
 *    server signs `pocket_send` with the bot account's function-call key, which
 *    can call that one method. The contract only pays Selkie handle accounts,
 *    only from the tweeting person's own pocket, only up to their daily limit.
 *    A stolen bot key or secret can do no more than that.
 *
 * Off entirely when NEAR_POCKET_CONTRACT is unset: GET /near/pocket says
 * `enabled: false`, pocket prepares are refused, the relayer funds no pocket
 * call, and /near/bot/send is a 404.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { HandleRef, Money } from "@selkie/core";
import { assertUsableBotSecret, handleKey } from "@selkie/core";
import {
  USDC_DECIMALS,
  fromBaseUnits,
  getPocket,
  isHandleAccount,
  isValidAccountId,
  pocketSend,
  toPositiveBaseUnits,
  type NearChain,
  type PocketView,
} from "@selkie/chain-near";
import { toXHandle } from "./x-handle";
import type { ActivityStore } from "../activity/store";
import type { IdentityService } from "../identity/service";
import type { UserStore } from "../identity/store";
import type { User } from "../identity/types";
import { userHandles } from "../identity/types";
import type { BalanceWatch } from "./balance-watch";
import type { NearAccountStore } from "./store";

/** What the bot account's key signs: the outcome of one `pocket_send`. */
export type PocketSendOutcome = Awaited<ReturnType<typeof pocketSend>>;

/** The bot account's key, as chain-near types it (the backend imports no NEAR SDK). */
type BotKey = Parameters<typeof pocketSend>[0]["botKey"];

/** The pocket contract as the server uses it. Amounts are USDC base units. */
export interface PocketChain {
  readonly contract: string;
  /** The owner's pocket, or null before their first top-up. */
  get(owner: string): Promise<PocketView | null>;
  /** Pay from a pocket with the bot's key. Absent where this server holds no bot key. */
  send?: (input: { owner: string; to: string; amount: string; memo?: string }) => Promise<PocketSendOutcome>;
}

export interface PocketEnv {
  contract: string;
  botAccount?: string;
  botKey?: BotKey;
}

/** The handle the web app tells people to tweet at. */
export const POCKET_BOT_HANDLE = "SelkiePay";

/** How the feed names the pocket when money moves in or out of it. */
export const POCKET_PARTY = "your X pocket";

/** The on-chain memo of a bot send when the tweet had no note. */
const DEFAULT_MEMO = "Sent from X";
const NOTE_MAX = 120;

/**
 * NEAR_POCKET_CONTRACT turns the pocket on; NEAR_POCKET_BOT_ACCOUNT and
 * NEAR_POCKET_BOT_KEY (both or neither) let this server send from pockets.
 * Errors never echo the key: it is a secret, and messages end up in logs.
 */
export function pocketConfigFromEnv(env: Record<string, string | undefined>): PocketEnv | null {
  const contract = env.NEAR_POCKET_CONTRACT?.trim();
  if (!contract) return null;
  if (!isValidAccountId(contract)) throw new Error("NEAR_POCKET_CONTRACT is not a NEAR account name");
  const botAccount = env.NEAR_POCKET_BOT_ACCOUNT?.trim() || undefined;
  const botKey = env.NEAR_POCKET_BOT_KEY?.trim() || undefined;
  if (Boolean(botAccount) !== Boolean(botKey)) {
    throw new Error("Set NEAR_POCKET_BOT_ACCOUNT and NEAR_POCKET_BOT_KEY together, or neither.");
  }
  if (botAccount && !isValidAccountId(botAccount)) throw new Error("NEAR_POCKET_BOT_ACCOUNT is not a NEAR account name");
  if (botKey && !/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(botKey)) throw new Error("NEAR_POCKET_BOT_KEY is not an ed25519 key");
  return { contract, botAccount, botKey: botKey as BotKey | undefined };
}

/**
 * SELKIE_BOT_SECRET, when set. Checked for length at startup, like the bot
 * checks it, rather than on the first tweet somebody sends.
 */
export function botSecretFromEnv(env: Record<string, string | undefined>): string | null {
  const secret = env.SELKIE_BOT_SECRET;
  if (!secret) return null;
  assertUsableBotSecret(secret);
  return secret;
}

/** The pocket contract on NEAR, read with the server's RPC and paid from with the bot's key. */
export function nearPocket(chain: NearChain, config: PocketEnv): PocketChain {
  const { contract, botAccount, botKey } = config;
  return {
    contract,
    get: (owner) => getPocket(chain.provider, contract, owner),
    send:
      botAccount && botKey
        ? (input) => pocketSend({ provider: chain.provider, pocket: contract, botAccount, botKey, ...input })
        : undefined,
  };
}

// ---- what GET /near/pocket answers ------------------------------------------

/** A pocket in decimal USDC ("12.5"), as the web app shows it. */
export interface PocketAmounts {
  balance: string;
  dailyCap: string;
  spentToday: string;
  leftToday: string;
}

export interface PocketInfo {
  enabled: boolean;
  contract: string | null;
  /** The X account to tweet at, without the @. */
  bot: string;
  /** Null until the first top-up. */
  pocket: PocketAmounts | null;
}

export function pocketAmounts(view: PocketView): PocketAmounts {
  return {
    balance: fromBaseUnits(view.balance, USDC_DECIMALS),
    dailyCap: fromBaseUnits(view.dailyCap, USDC_DECIMALS),
    spentToday: fromBaseUnits(view.spentToday, USDC_DECIMALS),
    leftToday: fromBaseUnits(view.leftToday, USDC_DECIMALS),
  };
}

// ---- the bot's send ---------------------------------------------------------

export type BotSendStatus = "sent" | "no-account" | "no-pocket" | "not-on-selkie" | "low-balance" | "over-cap" | "failed";

/** What `POST /near/bot/send` answers. Amounts are decimal USDC. */
export type BotSendResult =
  | { status: "sent"; txHash: string; explorerUrl: string; amount: string; to: string; toAccount: string; leftToday: string }
  | { status: Exclude<BotSendStatus, "sent">; leftToday?: string; message?: string };

/** What `POST /near/bot/request` answers: a tweeted ask, made on the spot. */
export type BotAskResult =
  | { status: "asked"; id: string; from: string; amount: string }
  | { status: "no-account" | "failed"; message: string };

export interface BotSendRecord {
  senderXUserId: string;
  /** Null while the first attempt is still running. */
  result: BotSendResult | BotAskResult | null;
}

/**
 * One answer per tweet. The bot can read the same mention twice (a restart, an
 * overlapping poll), and the second read must get the first answer back, never
 * a second payment.
 */
export interface BotSendStore {
  /**
   * Claim a tweet. Null means this call claimed it and must `finish` it;
   * otherwise it is what an earlier call recorded.
   */
  begin(tweetId: string, senderXUserId: string): Promise<BotSendRecord | null>;
  finish(tweetId: string, result: BotSendResult | BotAskResult): Promise<void>;
}

export class InMemoryBotSendStore implements BotSendStore {
  readonly #rows = new Map<string, BotSendRecord>();

  async begin(tweetId: string, senderXUserId: string) {
    const found = this.#rows.get(tweetId);
    if (found) return structuredClone(found);
    this.#rows.set(tweetId, { senderXUserId, result: null });
    return null;
  }

  async finish(tweetId: string, result: BotSendResult | BotAskResult) {
    const row = this.#rows.get(tweetId);
    if (row) row.result = structuredClone(result);
  }
}

export interface BotSendInput {
  senderXUserId: string;
  to: HandleRef;
  units: bigint;
  note?: string;
}

export interface PocketDeskDeps {
  pocket: PocketChain;
  chain: NearChain;
  accounts: NearAccountStore;
  users: UserStore;
  identity: IdentityService;
  activity: ActivityStore;
  watch: BalanceWatch;
}

const SAID = {
  noAccount: "Sign in to Selkie with this X account first.",
  self: "That's you. Pick someone else to pay.",
  notOnSelkie: "They haven't joined Selkie yet, so this one has to come from the app.",
  noPocket: "Top up your X pocket in Selkie first.",
  lowBalance: "Your X pocket is too low for that.",
  overCap: "That is more than your X pocket may send today.",
  failed: "The network would not take it. Nothing left your pocket.",
} as const;

/** Reads pockets for their owners and pays from them for the bot. */
export class PocketDesk {
  constructor(private readonly deps: PocketDeskDeps) {}

  get contract(): string {
    return this.deps.pocket.contract;
  }

  /** Whether this server holds the bot's key, so the bot can send. */
  get canSend(): boolean {
    return Boolean(this.deps.pocket.send);
  }

  async view(owner: string): Promise<PocketAmounts | null> {
    const view = await this.deps.pocket.get(owner);
    return view ? pocketAmounts(view) : null;
  }

  /**
   * Pay a Selkie handle from the tweeting person's pocket.
   *
   * The checks here mirror the contract's so the reply can say why, before any
   * gas is spent; the contract checks them all again and has the last word.
   * Only people already on Selkie can be paid: the escrow refunds an unclaimed
   * hold to whoever sent it, which would be the pocket contract, with no record
   * of whose money it was.
   */
  async botSend(input: BotSendInput): Promise<BotSendResult> {
    const send = this.deps.pocket.send;
    if (!send) throw new Error("This server holds no pocket bot key");
    const { activity, chain, watch } = this.deps;

    const record = await this.deps.accounts.findByXUserId(input.senderXUserId);
    const sender = record ? await this.deps.users.findByIdentity("x", input.senderXUserId) : null;
    if (!record || !sender) return { status: "no-account", message: SAID.noAccount };
    if (userHandles(sender).some((mine) => handleKey(mine) === handleKey(input.to))) {
      return { status: "failed", message: SAID.self };
    }

    const recipient = await this.deps.identity.findByHandle("x", input.to.username);
    if (recipient?.id === sender.id) return { status: "failed", message: SAID.self };
    if (!recipient || !isHandleAccount(recipient.address, chain.config.handleParent)) {
      return { status: "not-on-selkie", message: SAID.notOnSelkie };
    }

    const pocket = await this.deps.pocket.get(record.accountId);
    if (!pocket) return { status: "no-pocket", message: SAID.noPocket };
    const left = BigInt(pocket.leftToday);
    if (input.units > BigInt(pocket.balance)) {
      return { status: "low-balance", leftToday: decimal(left), message: SAID.lowBalance };
    }
    if (input.units > left) return { status: "over-cap", leftToday: decimal(left), message: SAID.overCap };

    // An ft_transfer to an account USDC has never seen fails. Free when it has.
    await chain.registerForUsdc(recipient.address);
    const amount: Money = { amount: decimal(input.units), asset: "USDC" };
    const memo = input.note?.trim().slice(0, NOTE_MAX) || DEFAULT_MEMO;

    // The recipient's balance changes under the watch's nose; say so first, so
    // it is never written down as money from outside Selkie.
    return watch.around([recipient.address], async (): Promise<BotSendResult> => {
      const outcome = await send({ owner: record.accountId, to: recipient.address, amount: input.units.toString(), memo });
      if (!outcome.ok) {
        console.warn("[pocket]", outcome.txHash, outcome.failure);
        return { status: "failed", message: SAID.failed };
      }
      await watch.expect(recipient.address, input.units);
      const from = userHandles(sender)[0];
      await activity.record(sender.id, {
        kind: "send",
        chain: "near",
        amount,
        counterparty: `@${input.to.username}`,
        counterpartyHandle: input.to,
        status: "confirmed",
        ref: outcome.txHash,
      });
      await activity.record(recipient.id, {
        kind: "receive",
        chain: "near",
        amount,
        ...(from ? { counterparty: `@${from.username}`, counterpartyHandle: from } : {}),
        status: "confirmed",
        ref: outcome.txHash,
      });
      return {
        status: "sent",
        txHash: outcome.txHash,
        explorerUrl: chain.txUrl(outcome.txHash),
        amount: amount.amount,
        to: input.to.username,
        toAccount: recipient.address,
        // Balance and the cap left both fell by the amount, so their minimum did too.
        leftToday: decimal(left - input.units),
      };
    });
  }
}

function decimal(units: bigint): string {
  return fromBaseUnits(units, USDC_DECIMALS);
}

// ---- routes -------------------------------------------------------------------

/** X ids are numbers; this is generous on length and strict on shape. */
export const X_ID = /^\d{1,32}$/;

/** Same length, constant time: compared as hashes so neither length nor content leaks. */
export function sameSecret(given: unknown, expected: string): boolean {
  if (typeof given !== "string" || given.length === 0) return false;
  const left = createHash("sha256").update(given).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function registerPocketRoutes(
  app: FastifyInstance,
  deps: {
    desk: PocketDesk | null;
    /** SELKIE_BOT_SECRET. Without it the bot route is off. */
    botSecret: string | null;
    sends: BotSendStore;
    botHandle?: string;
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<User | null>;
  },
): void {
  const bot = deps.botHandle ?? POCKET_BOT_HANDLE;

  /** The signed-in person's pocket, in decimal USDC. */
  app.get("/near/pocket", async (request, reply): Promise<PocketInfo | undefined> => {
    const user = await deps.requireUser(request, reply);
    if (!user) return;
    if (!deps.desk) return { enabled: false, contract: null, bot, pocket: null };
    return { enabled: true, contract: deps.desk.contract, bot, pocket: await deps.desk.view(user.address) };
  });

  /**
   * The bot asks to pay from somebody's pocket because they tweeted. Only the
   * bot holds the secret; the tweet's author is who it says, because the bot
   * read the author id off X itself.
   */
  app.post("/near/bot/send", async (request, reply) => {
    const { desk, botSecret } = deps;
    if (!desk || !desk.canSend || !botSecret) return reply.code(404).send({ error: "Not found." });
    if (!sameSecret(request.headers["x-selkie-bot-secret"], botSecret)) {
      return reply.code(401).send({ error: "That is not the bot." });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const tweetId = typeof body.tweetId === "string" ? body.tweetId : "";
    const senderXUserId = typeof body.senderXUserId === "string" ? body.senderXUserId : "";
    const to = typeof body.to === "string" ? toXHandle(body.to) : null;
    if (!X_ID.test(tweetId) || !X_ID.test(senderXUserId)) {
      return reply.code(400).send({ error: "A bot send needs the tweet id and its author's X id." });
    }
    if (!to) return reply.code(400).send({ error: "Add the handle you want to pay." });
    const units = toPositiveBaseUnits(typeof body.amount === "string" ? body.amount : "", USDC_DECIMALS);
    const note = typeof body.note === "string" ? body.note : undefined;

    const earlier = await deps.sends.begin(tweetId, senderXUserId);
    if (earlier) {
      if (earlier.result && earlier.senderXUserId === senderXUserId) return earlier.result;
      return reply.code(409).send({ error: "That post is already being handled." });
    }

    let result: BotSendResult;
    try {
      result = await desk.botSend({ senderXUserId, to, units, note });
    } catch (error) {
      // Recorded as failed rather than left open: a retry of the same tweet must
      // never be the thing that pays twice.
      console.error("[pocket] bot send", error instanceof Error ? error.message : error);
      result = { status: "failed", message: "We could not confirm it. Check your X pocket in Selkie before trying again." };
    }
    await deps.sends.finish(tweetId, result);
    return result;
  });
}
