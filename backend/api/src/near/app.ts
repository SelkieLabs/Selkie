import { createHash } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { HandleRef, Money } from "@selkie/core";
import { handleKey } from "@selkie/core";
import {
  AmountError,
  RelayRefusedError,
  USDC_DECIMALS,
  assertRelayable,
  directTransfer,
  fromBaseUnits,
  holdTransfer,
  recipientKeyFor,
  refundCall,
  relayPolicy,
  toPositiveBaseUnits,
  verifySignedDelegate,
  type Call,
  type NearChain,
  type TxOutcome,
} from "@selkie/chain-near";
import { BODY_LIMIT, LIMITS, publicUser, toHandle } from "../app";
import type { ActivityStore } from "../activity/store";
import { InMemoryActivityStore } from "../activity/store";
import { bearerToken } from "../auth";
import type { IdentityProvider } from "../identity/provider";
import { IdentityVerificationError } from "../identity/provider";
import type { ClaimOutcome } from "../identity/service";
import { IdentityService } from "../identity/service";
import type { UserStore } from "../identity/store";
import type { User } from "../identity/types";
import { userHandles } from "../identity/types";
import { NearAccountError, NearIdentityChain } from "./identity-chain";
import type { NearAccountStore, PaymentIntent, PrepareRecord, PrepareStore } from "./store";
import { noXLookup, type XUserLookup } from "./x-lookup";

export interface NearAppDeps {
  users: UserStore;
  provider: IdentityProvider;
  chain: NearChain;
  accounts: NearAccountStore;
  prepares: PrepareStore;
  activity?: ActivityStore;
  xLookup?: XUserLookup;
  limits?: Partial<Record<keyof typeof LIMITS, number>> | false;
}

/** How long a prepared payment may wait for its signature. Matches the delegate's block TTL. */
const PREPARE_TTL_MS = 5 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_MAX = 120;

type Reply = FastifyReply;

/** A request we will not carry out, with the status and the words to say why. */
class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The HTTP surface in NEAR mode (SELKIE_CHAIN=near).
 *
 * Same routes the web app already reads (session, me, handles, activity), with
 * the same account model behind them, plus the one real change: money moves by
 * prepare -> the user's key signs in the browser -> relay. The backend decides
 * what is signed and pays the gas; it never holds the key that signs.
 */
export async function buildNearApp(deps: NearAppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT });
  const limits = deps.limits === false ? null : { ...LIMITS, ...deps.limits };

  if (limits) {
    await app.register(rateLimit, {
      max: limits.global,
      timeWindow: "1 minute",
      keyGenerator: (request) => {
        const token = bearerToken(request.headers.authorization);
        return token ? createHash("sha256").update(token).digest("hex").slice(0, 32) : request.ip;
      },
      errorResponseBuilder: () => ({ statusCode: 429, message: "Too many tries. Wait a minute and try again." }),
    });
  }
  const capped = (which: keyof typeof LIMITS) =>
    limits ? { config: { rateLimit: { max: limits[which], timeWindow: "1 minute" } } } : {};

  const { chain } = deps;
  const config = chain.config;
  const near = new NearIdentityChain({ chain, accounts: deps.accounts });
  const identity = new IdentityService({
    users: deps.users,
    provider: deps.provider,
    adapter: near,
    onError: (error) => app.log.error(error),
  });
  const activity = deps.activity ?? new InMemoryActivityStore();
  const xLookup = deps.xLookup ?? noXLookup;
  const policy = relayPolicy({ usdc: config.usdcContract, escrow: config.escrowContract });

  async function requireUser(request: FastifyRequest, reply: Reply): Promise<User | null> {
    const token = bearerToken(request.headers.authorization);
    const result = token ? await identity.signIn(token, { createIfMissing: false }) : null;
    if (!result) {
      reply.code(401).send({ error: "Sign in to continue." });
      return null;
    }
    if (result.claimed.length > 0) await recordClaims(result.user.id, result.claimed);
    return result.user;
  }

  /** Money that was waiting just landed: one line for the receiver, and the senders stop "waiting". */
  async function recordClaims(userId: string, claimed: ClaimOutcome[]): Promise<void> {
    for (const outcome of claimed) {
      for (const amount of outcome.amounts) {
        await activity.record(userId, { kind: "claim", chain: "near", amount, status: "confirmed", ref: outcome.ref });
      }
      for (const paymentId of outcome.paymentIds) {
        await activity.settleByClaimRef(paymentId, "confirmed", outcome.ref);
      }
    }
  }

  function accountOf(user: User) {
    return {
      chain: "near" as const,
      handle: userHandles(user)[0] ?? { platform: "x" as const, username: user.id },
      address: user.address,
      status: "active" as const,
    };
  }

  app.get("/health", async () => ({ ok: true, chain: "near", network: config.network }));

  /** Sign in, or say the identity is new so the client asks once before creating. */
  app.post("/auth/session", capped("auth"), async (request, reply) => {
    const body = (request.body ?? {}) as { token?: string; createAccount?: boolean };
    if (!body.token) return reply.code(400).send({ error: "Sign in again to continue." });

    const result = await identity.signIn(body.token, { createIfMissing: body.createAccount === true });
    if (!result) {
      return reply.code(404).send({ status: "no-account", message: "Welcome to Selkie. Create your account to continue." });
    }
    await recordClaims(result.user.id, result.claimed);
    return { status: result.isNew ? "created" : "signed-in", user: publicUser(result.user), claimed: result.claimed };
  });

  app.get("/me", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    await identity.makeWalletReal(user);
    const balance = await near.getBalance(accountOf(user));
    return {
      user: publicUser(user),
      balances: balance.balances,
      near: { network: config.network, accountId: user.address, explorerUrl: chain.accountUrl(user.address) },
    };
  });

  /** Make sure the account can take USDC, then say where to send it. */
  app.post("/me/receive", capped("money"), async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    await near.ensureReceivable(user.address);
    return { address: user.address, accepts: ["USDC"], handles: userHandles(user) };
  });

  /**
   * The proof behind "Selkie holds no key": every key on the account, and
   * whether any of them is one of Selkie's.
   */
  app.get("/near/account/keys", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const record = await deps.accounts.findByAccountId(user.address);
    const ours = new Set(chain.selkieKeys());
    const keys = await chain.listKeys(user.address);
    return {
      accountId: user.address,
      explorerUrl: chain.accountUrl(user.address),
      keys: keys.map((key) => ({
        publicKey: key.publicKey,
        fullAccess: key.permission === "full",
        heldBy: ours.has(key.publicKey) ? "selkie" : key.publicKey === record?.publicKey ? "you" : "unknown",
      })),
      selkieHoldsKey: keys.some((key) => ours.has(key.publicKey)),
    };
  });

  /** Who you are about to pay, before you pay them. */
  app.get("/handles/:username", capped("handles"), async (request, reply) => {
    const caller = await requireUser(request, reply);
    if (!caller) return;
    const { username } = request.params as { username: string };
    const handle = toHandle(username, "x");
    if (!handle) return reply.code(400).send({ error: "Add the handle you want to pay." });

    const found = await identity.findByHandle("x", handle.username);
    const profile = found?.identities.find(
      (linked) => linked.provider === "x" && linked.username?.toLowerCase() === handle.username,
    );
    const base = {
      handle,
      onSelkie: Boolean(found),
      isYou: found?.id === caller.id,
      displayName: profile?.displayName,
      avatarUrl: profile?.avatarUrl,
    };
    if (found) return { ...base, nearAccount: found.address };
    const key = await recipientKeyFor({ username: handle.username, xUserId: await xLookup.idOf(handle.username) });
    return { ...base, recipientKey: key.key, scheme: key.scheme };
  });

  /**
   * Step one of paying: decide exactly what the user's key will sign.
   *
   * `{ to, amount, note? }` pays a handle (straight into their account if they
   * have one, into the escrow if not); `{ refundId }` takes back an expired one.
   */
  app.post("/near/payments/prepare", capped("money"), async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const account = await deps.accounts.findByAccountId(user.address);
    if (!account) return reply.code(409).send({ error: "Your account is still being set up. Sign in again." });

    const body = (request.body ?? {}) as { to?: string; amount?: string; note?: string; refundId?: string | number };
    const planned = body.refundId !== undefined ? await planRefund(user, String(body.refundId)) : await planSend(user, body);

    const delegate = await chain.prepare(user.address, account.publicKey, planned.call);
    assertRelayable(delegate, policy);
    const record = await deps.prepares.create({
      userId: user.id,
      delegate,
      intent: planned.intent,
      expiresAt: new Date(Date.now() + PREPARE_TTL_MS).toISOString(),
    });
    return { prepareId: record.id, delegate, intent: planned.intent };
  });

  async function planSend(
    user: User,
    body: { to?: string; amount?: string; note?: string },
  ): Promise<{ call: Call; intent: PaymentIntent }> {
    const to = body.to ? toHandle(body.to, "x") : null;
    if (!to) throw new Refusal(400, "Add the handle you want to pay.");
    if (userHandles(user).some((mine) => handleKey(mine) === handleKey(to))) {
      throw new Refusal(400, "That's you. Pick someone else to pay.");
    }
    const units = toPositiveBaseUnits(String(body.amount ?? ""), USDC_DECIMALS);
    const amount: Money = { amount: fromBaseUnits(units, USDC_DECIMALS), asset: "USDC" };
    if ((await chain.usdcBalance(user.address)) < units) {
      throw new Refusal(409, "Your balance is too low. Add money, or send a smaller amount.");
    }
    const memo = body.note?.trim().slice(0, NOTE_MAX) || undefined;

    const recipient = await identity.findByHandle("x", to.username);
    if (recipient) {
      // Heals an account that somehow missed registration; free when it did not.
      await chain.registerForUsdc(recipient.address);
      return {
        call: directTransfer(config.usdcContract, { to: recipient.address, amount: units.toString(), memo }),
        intent: { kind: "send", to, amount, recipientAccount: recipient.address, recipientUserId: recipient.id },
      };
    }
    const key = await recipientKeyFor({ username: to.username, xUserId: await xLookup.idOf(to.username) });
    return {
      call: holdTransfer(config.usdcContract, config.escrowContract, {
        amount: units.toString(),
        recipient: key.key,
        lifetimeSecs: config.claimLifetimeSecs,
        memo,
      }),
      intent: { kind: "hold", to, amount, recipientKey: key.key, scheme: key.scheme },
    };
  }

  async function planRefund(user: User, claimRef: string): Promise<{ call: Call; intent: PaymentIntent }> {
    if (!/^\d{1,20}$/.test(claimRef)) throw new Refusal(400, "We lost track of that payment.");
    const entry = await activity.findByClaimRef(user.id, claimRef);
    const payment = await chain.getPayment(claimRef);
    if (!entry || !payment || payment.sender !== user.address) {
      throw new Refusal(409, "That payment was already claimed or returned.");
    }
    const expiresMs = Number(BigInt(payment.expiry_ns) / 1_000_000n);
    if (expiresMs > Date.now()) {
      throw new Refusal(409, `You can take this back ${inWords(expiresMs - Date.now())}.`);
    }
    return {
      call: refundCall(config.escrowContract, claimRef),
      intent: { kind: "refund", claimRef, amount: { amount: fromBaseUnits(payment.amount, USDC_DECIMALS), asset: "USDC" } },
    };
  }

  /**
   * Step two: the signed action comes back. It is relayed only if it is exactly
   * what step one prepared for this user, unused and unexpired (design 5.5).
   */
  app.post("/near/relay", capped("money"), async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const body = (request.body ?? {}) as { prepareId?: string; signedDelegate?: string };
    if (!body.prepareId || !UUID.test(body.prepareId) || typeof body.signedDelegate !== "string") {
      return reply.code(400).send({ error: "Nothing moved. Start the payment again." });
    }
    const record = await deps.prepares.take(body.prepareId, user.id);
    if (!record) return reply.code(410).send({ error: "That confirmation expired. Nothing moved. Start again." });
    if (record.delegate.senderId !== user.address) {
      return reply.code(403).send({ error: "Nothing moved. Start the payment again." });
    }

    assertRelayable(record.delegate, policy);
    const signed = await verifySignedDelegate(record.delegate, body.signedDelegate);
    const outcome = await chain.relay(signed);
    return settle(user, record, outcome, reply);
  });

  async function settle(user: User, record: PrepareRecord, outcome: TxOutcome, reply: Reply) {
    const ref = outcome.txHash;
    const explorer = chain.txUrl(ref);
    if (outcome.failure) {
      app.log.warn({ tx: ref, failure: outcome.failure }, "relayed transaction failed");
      return reply.code(409).send({ error: explainFailure(outcome.failure), ref, explorer });
    }

    const intent = record.intent;
    if (intent.kind === "send") {
      await activity.record(user.id, sendEntry(intent.to, intent.amount, "confirmed", ref));
      await activity.record(intent.recipientUserId, {
        kind: "receive",
        chain: "near",
        amount: intent.amount,
        ...counterparty(userHandles(user)[0]),
        status: "confirmed",
        ref,
      });
      return { status: "confirmed", ref, explorer, waitingToBeClaimed: false, message: `Sent to @${intent.to.username}.` };
    }

    if (intent.kind === "hold") {
      const hold = outcome.events.find((event) => event.event === "hold")?.data[0];
      if (!hold) {
        // The escrow refused the msg and the token sent the money straight back.
        return reply.code(409).send({ error: "Nothing moved. The money is still with you. Try again.", ref, explorer });
      }
      const claimRef = String(hold.id);
      const refundableAt = new Date(Number(BigInt(String(hold.expiry_ns)) / 1_000_000n)).toISOString();
      await activity.record(user.id, { ...sendEntry(intent.to, intent.amount, "pending", ref), claimRef, refundableAt });
      return {
        status: "pending",
        ref,
        explorer,
        claimRef,
        waitingToBeClaimed: true,
        message: `Sent. It is waiting for @${intent.to.username} to claim.`,
      };
    }

    const refunded = outcome.events.some((event) => event.event === "refund");
    if (!refunded) {
      return reply.code(409).send({ error: "Nothing moved. Try taking it back again in a moment.", ref, explorer });
    }
    const entry = await activity.findByClaimRef(user.id, intent.claimRef);
    if (entry) await activity.settle(user.id, entry.id, "returned", ref);
    return { status: "returned", ref, explorer, waitingToBeClaimed: false, message: "It's back in your balance." };
  }

  app.get("/activity", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { limit } = (request.query ?? {}) as { limit?: string };
    const parsed = Number(limit);
    const cap = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
    return { entries: await activity.list(user.id, { limit: cap }) };
  });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof IdentityVerificationError) {
      console.warn("[auth]", error.message);
      return reply.code(401).send({ error: "We could not verify that sign-in. Sign in again." });
    }
    if (error instanceof Refusal) return reply.code(error.status).send({ error: error.message });
    if (error instanceof NearAccountError) return reply.code(400).send({ error: error.message });
    if (error instanceof AmountError) return reply.code(400).send({ error: "Enter an amount above zero, up to 6 decimal places." });
    if (error instanceof RelayRefusedError) {
      console.warn("[relay]", error.message);
      return reply.code(400).send({ error: "We could not confirm that signature. Nothing moved. Try again." });
    }
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) return reply.code(status).send({ error: error.message });
    console.error("[api]", error);
    return reply.code(500).send({ error: "Something went wrong on our side. Try again." });
  });

  return app;
}

function sendEntry(to: HandleRef, amount: Money, status: "pending" | "confirmed", ref: string) {
  return { kind: "send" as const, chain: "near", amount, ...counterparty(to), status, ref };
}

function counterparty(handle: HandleRef | undefined) {
  return handle ? { counterparty: `@${handle.username}`, counterpartyHandle: handle } : {};
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
