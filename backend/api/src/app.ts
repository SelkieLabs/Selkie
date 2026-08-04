import { createHash } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import type { StellarAdapter } from "@selkie/chain-stellar";
import {
  TransactionRejectedError,
  isStellarAddress,
  looksLikeAddress,
  shortAddress,
} from "@selkie/chain-stellar";
import type {
  HandleRef,
  HistoryEntry,
  Money,
  PaymentResult,
  SwapProvider,
} from "@selkie/core";
import { handleKey, parseHandle } from "@selkie/core";
import type { ActivityStore } from "./activity/store";
import { InMemoryActivityStore } from "./activity/store";
import type { IdempotencyStore } from "./idempotency/store";
import { InMemoryIdempotencyStore } from "./idempotency/store";
import type { RequestStore } from "./requests/store";
import { InMemoryRequestStore } from "./requests/store";
import { recordClaims } from "./claims/collect";
import type { HandleIndex } from "./claims/index-store";
import { bearerToken } from "./auth";
import type { IdentityProvider } from "./identity/provider";
import { IdentityVerificationError } from "./identity/provider";
import { IdentityService } from "./identity/service";
import type { UserStore } from "./identity/store";
import type { IdentityProviderId, User } from "./identity/types";
import { isPayable, userHandles } from "./identity/types";

/** Just enough of the chain reader to merge deposits into a feed. */
export interface DepositReader {
  incoming(address: string, options?: { limit?: number }): Promise<HistoryEntry[]>;
}

export interface AppDeps {
  users: UserStore;
  provider: IdentityProvider;
  adapter: StellarAdapter;
  swap: SwapProvider;
  /**
   * Reads money that arrived without Selkie's help. Optional: without it the
   * feed still works, it just cannot see deposits made from outside the app.
   */
  deposits?: DepositReader;
  activity?: ActivityStore;
  requests?: RequestStore;
  idempotency?: IdempotencyStore;
  /** Lets money arriving later be recognised. See claims/index-store.ts. */
  handles?: HandleIndex;
  /**
   * Per-minute caps, or `false` to turn them off.
   *
   * Off is for tests, which make hundreds of calls from one address in a few
   * seconds and would otherwise spend their time proving the rate limiter
   * works. One test turns it on with tiny numbers and proves exactly that.
   */
  limits?: Partial<Record<keyof typeof LIMITS, number>> | false;
}

/** Paying more people than this at once is a mistake, not a feature. */
const MAX_BATCH = 100;

/**
 * How hard any one caller may push, per minute.
 *
 * Looking a handle up is cheap for us and useful to somebody enumerating who
 * uses Selkie, so it is capped hardest relative to how often a real person does
 * it. Moving money is capped because every call costs the sponsor a fee, and
 * nobody sends thirty payments a minute by hand.
 */
const LIMITS = {
  global: 300,
  auth: 30,
  handles: 60,
  money: 30,
} as const;

/**
 * A request body big enough for a hundred handles and nothing like big enough
 * to be worth sending as an attack.
 */
const BODY_LIMIT = 128 * 1024;

/**
 * The HTTP surface. Thin on purpose: routes parse input, call a service, and
 * shape a response. Every decision that matters lives in IdentityService or the
 * chain adapter, so the bot and the web app get identical behaviour.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT });
  const limits = deps.limits === false ? null : { ...LIMITS, ...deps.limits };

  // Registered before any route, because the per-route caps below are read by a
  // hook this plugin installs and a route added first would never see it.
  if (limits) {
    await app.register(rateLimit, {
      max: limits.global,
      timeWindow: "1 minute",
      // Signed-in callers are limited as themselves, so one busy office behind
      // one address does not throttle everybody in it. Hashed, because the
      // limiter keeps its keys in memory and a raw token is a credential.
      keyGenerator: (request) => {
        const token = bearerToken(request.headers.authorization);
        return token ? createHash("sha256").update(token).digest("hex").slice(0, 32) : request.ip;
      },
      // Thrown as an error, so it travels through setErrorHandler below and has
      // to carry its own status. Without one it arrives looking like a crash and
      // gets reported to the caller as our fault.
      errorResponseBuilder: () => ({
        statusCode: 429,
        message: "That is a lot of requests. Slow down a moment.",
      }),
    });
  }

  /**
   * Per-route cap, or nothing at all when limits are off.
   *
   * Takes the name rather than the number so it reads from the merged config.
   * Passing `LIMITS.handles` here would bake in the default and silently ignore
   * every override, which is exactly the bug the limiter's own test caught.
   */
  const capped = (which: keyof typeof LIMITS) =>
    limits ? { config: { rateLimit: { max: limits[which], timeWindow: "1 minute" } } } : {};

  const identity = new IdentityService(deps);
  const activity = deps.activity ?? new InMemoryActivityStore();
  const requests = deps.requests ?? new InMemoryRequestStore();
  const idempotency = deps.idempotency ?? new InMemoryIdempotencyStore();

  /** Resolve the caller, or reply 401. Returns null when it has already replied. */
  async function requireUser(request: FastifyRequest, reply: {
    code: (n: number) => { send: (body: unknown) => unknown };
  }): Promise<User | null> {
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      reply.code(401).send({ error: "Sign in to continue." });
      return null;
    }
    // A local signature check and one lookup in our own database. Deliberately
    // not the sign-in path: that costs a round trip to the identity provider and
    // releases escrowed money, neither of which belongs on every request.
    const user = await identity.authenticate(token);
    if (!user) {
      reply.code(401).send({ error: "Sign in to continue." });
      return null;
    }
    return user;
  }

  /**
   * Run a money-moving handler at most once per `Idempotency-Key`.
   *
   * Wrapped around the part that actually moves money, never around the
   * validation above it: a request refused for a bad amount should succeed when
   * the amount is fixed, and memoizing that refusal would make the fix look
   * broken.
   *
   * Without a key, nothing changes. That is deliberate: the header is a promise
   * from the client that two requests carrying it are the same intent, and
   * inventing one on the server would be a guess.
   */
  async function once<T>(
    request: FastifyRequest,
    userId: string,
    reply: { code: (n: number) => { send: (body: unknown) => unknown } },
    run: () => Promise<T>,
  ): Promise<T | unknown> {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length === 0) return run();

    const state = await idempotency.begin(userId, key);
    if (state.kind === "done") return state.record.body;
    if (state.kind === "in-flight") {
      return reply.code(409).send({ error: "That is already going through. Give it a moment." });
    }

    try {
      const body = await run();
      await idempotency.complete(userId, key, { status: 200, body });
      return body;
    } catch (error) {
      // A key held by work that failed would block the genuine retry it exists
      // to make safe, so failure lets go of it.
      await idempotency.release(userId, key);
      throw error;
    }
  }

  /**
   * Move money to a handle and write both sides of the story.
   *
   * Every way to pay in this API ends up here: a single send, answering a
   * request, and paying a list. One path means one set of rules about what gets
   * recorded and what the recipient sees.
   */
  async function pay(
    user: User,
    from: HandleRef,
    to: HandleRef,
    money: Money,
    note?: string,
  ): Promise<PaymentResult> {
    const result = await deps.adapter.send(from, to, money, note);

    await activity.record(user.id, {
      kind: "send",
      chain: "stellar",
      amount: money,
      counterparty: `@${to.username}`,
      counterpartyHandle: to,
      status: result.heldForClaim ? "pending" : "confirmed",
      ref: result.ref,
      // Only money that is waiting can be taken back, and taking it back needs
      // the escrow's id for the payment rather than the transaction's.
      ...(result.heldForClaim && result.claimRef
        ? {
            claimRef: result.claimRef,
            refundableAt: new Date(
              Date.now() + deps.adapter.claimLifetimeSeconds * 1000,
            ).toISOString(),
          }
        : {}),
    });

    // The other side gets their own entry, so someone who already uses Selkie
    // sees the money arrive rather than a balance that changed for no reason.
    const recipient = await identity.findByHandle(to.platform as IdentityProviderId, to.username);
    if (recipient && recipient.id !== user.id) {
      await activity.record(recipient.id, {
        kind: "receive",
        chain: "stellar",
        amount: money,
        counterparty: `@${from.username}`,
        counterpartyHandle: from,
        status: result.heldForClaim ? "pending" : "confirmed",
        ref: result.ref,
      });
    }

    return result;
  }

  /** Claiming and recording, shared with the background watcher. */
  const claims = { identity, activity };

  app.get("/health", async () => ({ ok: true }));

  /**
   * Sign in, or report that this identity is new so the client can ask once
   * before creating an account. That question is what stops one person from
   * ending up with two wallets.
   */
  app.post("/auth/session", capped("auth"), async (request, reply) => {
    const body = (request.body ?? {}) as { token?: string; createAccount?: boolean };
    if (!body.token) return reply.code(400).send({ error: "Missing token." });

    const result = await identity.signIn(body.token, {
      createIfMissing: body.createAccount === true,
    });

    if (!result) {
      return reply.code(404).send({
        status: "no-account",
        message: "Welcome to Selkie. Create your wallet to continue.",
      });
    }

    await recordClaims(claims, result.user.id, result.claimed);

    return {
      status: result.isNew ? "created" : "signed-in",
      user: publicUser(result.user),
      claimed: result.claimed,
    };
  });

  /**
   * Link another identity to the signed-in account. On success anything the
   * escrow was holding for that handle is already in their wallet.
   */
  app.post("/auth/link", capped("auth"), async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const body = (request.body ?? {}) as { token?: string };
    if (!body.token) return reply.code(400).send({ error: "Missing token." });

    const result = await identity.link(user.id, body.token);
    if (result.status === "merge-required") {
      return reply.code(409).send({
        status: "merge-required",
        message: "This account already has a Selkie wallet. Bring it into this one?",
        mergeCandidate: result.mergeCandidate,
      });
    }

    await recordClaims(claims, result.user.id, result.claimed);
    return { status: "linked", user: publicUser(result.user), claimed: result.claimed };
  });

  /** Confirmed merge. Separate from linking because it moves money. */
  app.post("/auth/merge", capped("auth"), async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const body = (request.body ?? {}) as { fromUserId?: string };
    if (!body.fromUserId) return reply.code(400).send({ error: "Missing fromUserId." });

    const merged = await identity.merge(user.id, body.fromUserId);
    return { status: "merged", user: publicUser(merged) };
  });

  app.get("/me", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const balance = await deps.adapter.getBalance(accountOf(user));
    return { user: publicUser(user), balances: balance.balances };
  });

  /**
   * Who you are about to pay, before you pay them.
   *
   * A mistyped handle is the most common way people lose money in an app like
   * this, and the only real defence is showing a face and a name on the confirm
   * screen. A handle nobody has claimed yet is still a valid destination, so this
   * answers "we do not know them yet", never "no".
   */
  app.get("/handles/:username", capped("handles"), async (request, reply) => {
    const caller = await requireUser(request, reply);
    if (!caller) return;

    const { username } = request.params as { username: string };
    const { platform = "x" } = (request.query ?? {}) as { platform?: string };
    if (!isPayable(platform as IdentityProviderId)) {
      return reply.code(400).send({ error: "You can pay an X or a Telegram handle." });
    }

    const handle = toHandle(username, platform as "x" | "telegram");
    if (!handle) return reply.code(400).send({ error: "Who are you paying?" });

    const found = await identity.findByHandle(platform as IdentityProviderId, handle.username);
    const profile = found?.identities.find(
      (linked) => linked.provider === platform && linked.username?.toLowerCase() === handle.username,
    );

    return {
      handle,
      onSelkie: Boolean(found),
      isYou: Boolean(found) && found?.id === caller.id,
      displayName: profile?.displayName,
      avatarUrl: profile?.avatarUrl,
    };
  });

  /**
   * Send money to a handle. The adapter decides whether that settles directly or
   * waits in the escrow for someone who has not joined yet.
   */
  app.post("/payments/send", capped("money"), async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const body = (request.body ?? {}) as {
      to?: string;
      platform?: string;
      amount?: string;
      asset?: string;
      note?: string;
    };
    if (!body.to || !body.amount) {
      return reply.code(400).send({ error: "Who are you paying, and how much?" });
    }

    const money: Money = { amount: body.amount, asset: (body.asset ?? "USDC").toUpperCase() };

    /**
     * Paying an address instead of a handle.
     *
     * Handled before the handle path and separately from it, because almost
     * nothing is shared: there is no escrow, nothing to claim, nobody to
     * notify, and no way to provision the far end out of trouble. It exists
     * because "send it to my other wallet" and "pay this exchange" are real
     * and Selkie is not the only place money lives.
     */
    // Shaped like an address but failing its checksum is a typo, never a
    // handle. Falling through to the handle path here would send real money to
    // whoever happens to have registered that name.
    if (looksLikeAddress(body.to) && !isStellarAddress(body.to)) {
      return reply.code(400).send({
        error: "That address is not right. Check it for a missing or changed character.",
      });
    }

    if (isStellarAddress(body.to)) {
      const to = body.to.trim().toUpperCase();
      if (to === user.address) {
        return reply.code(400).send({ error: "That is your own address." });
      }

      const receivable = await deps.adapter.canReceive(to, money.asset);
      if (!receivable.ok) {
        return reply.code(409).send({
          error:
            receivable.reason === "no-account"
              ? "That address is not set up yet, so money sent to it would be lost. Ask them to add some XLM to it first."
              : `That address cannot accept ${money.asset} yet. Ask them to turn it on, then try again.`,
        });
      }

      return once(request, user.id, reply, async () => {
        const result = await deps.adapter.transfer({
          fromAddress: user.address,
          toAddress: to,
          amount: money,
        });

        await activity.record(user.id, {
          kind: "send",
          chain: "stellar",
          amount: money,
          counterparty: shortAddress(to),
          status: "confirmed",
          ref: result.ref,
        });

        return { status: result.status, ref: result.ref, message: "Sent.", waitingToBeClaimed: false };
      });
    }

    const from = userHandles(user)[0];
    if (!from) {
      return reply.code(409).send({
        error: "Link your X or Telegram account before sending.",
      });
    }

    const to = toHandle(body.to, (body.platform ?? "x") as "x" | "telegram");
    if (!to) return reply.code(400).send({ error: "Who are you paying, and how much?" });

    return once(request, user.id, reply, async () => {
      const result = await pay(user, from, to, money, body.note);
      return {
        status: result.status,
        ref: result.ref,
        // Plain language, because this is what the UI shows.
        message: result.heldForClaim
          ? `Sent. It is waiting for @${to.username} to claim.`
          : `Sent to @${to.username}.`,
        waitingToBeClaimed: result.heldForClaim,
      };
    });
  });

  /**
   * The address to put money into, ready to actually receive it.
   *
   * Not a read: it makes the wallet real on the ledger and opens the trustlines
   * first. An address with no account behind it cannot be paid, and one with no
   * trustline bounces the payment back to the sender. Both of those fail at the
   * sender's end, after the money has left, which is the worst place to find out.
   */
  app.post("/me/receive", capped("money"), async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const ready = await deps.adapter.ensureReceivable(user.address);
    return {
      address: ready.address,
      accepts: ready.accepts,
      handles: userHandles(user),
    };
  });

  /**
   * Ask someone for money.
   *
   * A request moves nothing by itself; only the person it is addressed to can
   * turn it into a payment. That is the whole security model, and it is why the
   * pay route below checks the handle rather than the id.
   */
  app.post("/requests", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const body = (request.body ?? {}) as {
      from?: string;
      platform?: string;
      amount?: string;
      asset?: string;
      note?: string;
    };
    if (!body.from || !body.amount) {
      return reply.code(400).send({ error: "Who are you asking, and for how much?" });
    }

    const asker = userHandles(user)[0];
    if (!asker) {
      return reply.code(409).send({
        error: "Link your X or Telegram account before asking for money.",
      });
    }

    const target = toHandle(body.from, (body.platform ?? "x") as "x" | "telegram");
    if (!target) return reply.code(400).send({ error: "Who are you asking?" });
    if (handleKey(target) === handleKey(asker)) {
      return reply.code(400).send({ error: "You cannot ask yourself for money." });
    }

    const created = await requests.create({
      fromUserId: user.id,
      fromHandle: asker,
      toHandle: target,
      amount: { amount: body.amount, asset: (body.asset ?? "USDC").toUpperCase() },
      note: body.note,
    });

    return { status: "asked", request: created, message: `Asked @${target.username}.` };
  });

  /** Requests waiting on you, and requests you are waiting on. */
  app.get("/requests", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const [incoming, outgoing] = await Promise.all([
      requests.addressedTo(userHandles(user)),
      requests.sentBy(user.id),
    ]);
    return { incoming, outgoing };
  });

  /** Pay a request. Only the person it was addressed to can. */
  app.post("/requests/:id/pay", capped("money"), async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };
    const found = await requests.get(id);
    // Same answer for "does not exist" and "not yours": knowing a request id
    // should never tell you a request exists.
    if (!found || !ownsHandle(user, found.toHandle)) {
      return reply.code(404).send({ error: "That request is not waiting for you." });
    }
    if (found.status !== "pending") {
      return reply.code(409).send({ error: "That request was already settled." });
    }

    const from = userHandles(user)[0];
    if (!from) return reply.code(409).send({ error: "Link an account before paying." });

    return once(request, user.id, reply, async () => {
      const result = await pay(user, from, found.fromHandle, found.amount, found.note);
      const settled = await requests.settle(id, "paid", result.ref);
      return {
        status: "paid",
        request: settled,
        message: `Paid @${found.fromHandle.username}.`,
      };
    });
  });

  /** Turn a request down. Also only the person it was addressed to. */
  app.post("/requests/:id/decline", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };
    const found = await requests.get(id);
    if (!found || !ownsHandle(user, found.toHandle)) {
      return reply.code(404).send({ error: "That request is not waiting for you." });
    }
    if (found.status !== "pending") {
      return reply.code(409).send({ error: "That request was already settled." });
    }
    return { status: "declined", request: await requests.settle(id, "declined") };
  });

  /** Withdraw a request you sent. Only the asker. */
  app.post("/requests/:id/cancel", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };
    const found = await requests.get(id);
    if (!found || found.fromUserId !== user.id) {
      return reply.code(404).send({ error: "That is not your request." });
    }
    if (found.status !== "pending") {
      return reply.code(409).send({ error: "That request was already settled." });
    }
    return { status: "cancelled", request: await requests.settle(id, "cancelled") };
  });

  /**
   * Pay a list of handles the same amount each.
   *
   * The total is checked against the balance before anything moves, because
   * running out of money halfway down a list of forty people is not a failure
   * anyone can explain afterwards. Individual sends can still fail on their own,
   * so the response says what happened to every single handle.
   */
  app.post("/payments/batch", capped("money"), async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const body = (request.body ?? {}) as {
      to?: string[];
      platform?: string;
      amount?: string;
      asset?: string;
      note?: string;
    };
    if (!Array.isArray(body.to) || body.to.length === 0 || !body.amount) {
      return reply.code(400).send({ error: "Who are you paying, and how much each?" });
    }
    if (body.to.length > MAX_BATCH) {
      return reply.code(400).send({ error: `That is more than ${MAX_BATCH} people at once.` });
    }

    const from = userHandles(user)[0];
    if (!from) {
      return reply.code(409).send({ error: "Link your X or Telegram account before sending." });
    }

    const platform = (body.platform ?? "x") as "x" | "telegram";
    const asset = (body.asset ?? "USDC").toUpperCase();
    const each: Money = { amount: body.amount, asset };

    // Dedupe, and never pay yourself out of your own batch.
    const seen = new Set<string>([handleKey(from)]);
    const targets: HandleRef[] = [];
    for (const raw of body.to) {
      const handle = toHandle(raw, platform);
      if (!handle || seen.has(handleKey(handle))) continue;
      seen.add(handleKey(handle));
      targets.push(handle);
    }
    if (targets.length === 0) return reply.code(400).send({ error: "Nobody left to pay." });

    const balance = await deps.adapter.getBalance(accountOf(user));
    const available = Number(balance.balances.find((money) => money.asset === asset)?.amount ?? 0);
    const total = Number(body.amount) * targets.length;
    if (!Number.isFinite(total) || total > available) {
      return reply.code(409).send({
        error: `That comes to more than you have. ${targets.length} people at ${body.amount} is ${total}.`,
      });
    }

    return once(request, user.id, reply, async () => {
      const results = [];
      for (const to of targets) {
        try {
          const result = await pay(user, from, to, each, body.note);
          results.push({
            handle: `@${to.username}`,
            sent: true,
            waitingToBeClaimed: result.heldForClaim,
          });
        } catch (error) {
          // One bad handle must not take the rest of the list down with it.
          console.error("[batch]", to.username, error);
          results.push({ handle: `@${to.username}`, sent: false });
        }
      }

      const sent = results.filter((result) => result.sent).length;
      return {
        status: "done",
        results,
        message:
          sent === results.length
            ? `Sent to ${sent} ${sent === 1 ? "person" : "people"}.`
            : `Sent to ${sent} of ${results.length}. The rest did not go through.`,
      };
    });
  });

  /**
   * Take back money that waited for someone who never came.
   *
   * Anyone's money can wait, but nobody's money can be stuck. A payment to a
   * handle that never joins would otherwise sit in the contract forever, so
   * this is the other end of the escrow and not an optional extra.
   *
   * The contract enforces both rules on its own: only the original sender, and
   * only after the wait is over. Checking them here too is what turns a contract
   * error code into a sentence somebody can act on.
   */
  app.post("/payments/:claimRef/refund", capped("money"), async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const { claimRef } = request.params as { claimRef: string };
    const entry = await activity.findByClaimRef(user.id, claimRef);
    // Same answer for "no such payment" and "not yours": knowing an id must
    // never confirm that a payment exists.
    if (!entry || entry.kind !== "send") {
      return reply.code(404).send({ error: "That payment is not one of yours." });
    }
    if (entry.status !== "pending") {
      return reply.code(409).send({ error: "That payment is already settled." });
    }
    if (entry.refundableAt && Date.now() < Date.parse(entry.refundableAt)) {
      return reply.code(409).send({
        error: "This one is still waiting to be claimed. You can take it back later.",
        refundableAt: entry.refundableAt,
      });
    }

    return once(request, user.id, reply, async () => {
      const result = await deps.adapter.refund(BigInt(claimRef), user.address);
      const settled = await activity.settle(user.id, entry.id, "returned", result.ref);
      return {
        status: "returned",
        entry: settled,
        message: `Taken back. ${entry.counterparty ?? "It"} never claimed it.`,
      };
    });
  });

  /** What one asset is worth in another right now, quoted by the network itself. */
  app.get("/payments/convert/quote", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const query = (request.query ?? {}) as { from?: string; to?: string; amount?: string };
    if (!query.from || !query.to || !query.amount) {
      return reply.code(400).send({ error: "What are you converting, and how much?" });
    }

    const quote = await deps.swap.quote(
      { amount: query.amount, asset: query.from.toUpperCase() },
      query.to.toUpperCase(),
    );
    return { from: quote.from, to: quote.to };
  });

  /** Convert one asset into another. Fees are sponsored, same as everything else. */
  app.post("/payments/convert", capped("money"), async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const body = (request.body ?? {}) as { from?: string; to?: string; amount?: string };
    if (!body.from || !body.to || !body.amount) {
      return reply.code(400).send({ error: "What are you converting, and how much?" });
    }

    const source: Money = { amount: body.amount, asset: body.from.toUpperCase() };
    const target = body.to.toUpperCase();

    return once(request, user.id, reply, async () => {
      const quote = await deps.swap.quote(source, target);

      /**
       * Make sure the money has somewhere to land.
       *
       * A conversion is a payment to yourself with a different asset coming
       * out, so the same rule that governs being paid governs this: an account
       * that has never opted into an asset cannot receive it, and the network
       * rejects the whole transaction. Deposit provisions the wallet, but
       * nobody has to visit Deposit before converting, and finding out at the
       * point of sale is finding out too late. Idempotent and sponsored, so
       * this costs the user nothing and does nothing when already set up.
       */
      await deps.adapter.ensureReceivable(user.address);

      const { ref } = await deps.swap.swap(accountOf(user), source, target);

      await activity.record(user.id, {
        kind: "swap",
        chain: "stellar",
        amount: source,
        counterparty: quote.to.asset,
        status: "confirmed",
        ref,
      });

      return { status: "confirmed", ref, received: quote.to, message: `Converted to ${target}.` };
    });
  });

  /** The activity feed. Newest first, already in the order it is shown. */
  app.get("/activity", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const { limit } = (request.query ?? {}) as { limit?: string };
    const parsed = Number(limit);
    const cap = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;

    const mine = await activity.list(user.id, { limit: cap });

    // Money can arrive without Selkie ever being asked: someone pastes their
    // address into an exchange or another wallet. Nothing writes an entry for
    // that, so the feed has to go and look, or it says "nothing here yet" while
    // the balance plainly disagrees.
    let deposits: HistoryEntry[] = [];
    if (deps.deposits) {
      try {
        deposits = await deps.deposits.incoming(user.address, { limit: cap });
      } catch (error) {
        // A feed missing its deposits is worse than the alternative, but far
        // better than a feed that will not load at all because Horizon blinked.
        request.log.warn({ error }, "could not read deposits");
      }
    }

    return { entries: mergeActivity(mine, deposits, cap) };
  });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof IdentityVerificationError) {
      // The reason goes to the log, never to the client: it is how we tell a
      // stale token from a misconfigured app, and it never contains the token.
      console.warn("[auth]", error.message);
      return reply.code(401).send({ error: "That sign-in could not be verified." });
    }

    // Fastify's own refusals — too many requests, a body too big, malformed
    // JSON — already say something true and safe. Turning them into a 500 would
    // tell the caller "our fault" about a problem that is theirs to fix, and
    // would have hidden the rate limiter entirely.
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: error.message });
    }

    /**
     * A transaction the network refused is not our server falling over, and
     * saying so wastes the one piece of information that would let someone fix
     * it. The codes are logged in full either way.
     */
    if (error instanceof TransactionRejectedError) {
      console.error("[chain]", error.transactionCode, error.operationCodes.join(","));
      return reply.code(409).send({ error: explainRejection(error) });
    }

    // Never leak internals to a client; the detail goes to the server log.
    console.error("[api]", error);
    return reply.code(500).send({ error: "Something went wrong on our side." });
  });

  return app;
}

/**
 * What a rejected transaction means, in words the person reading it can act on.
 *
 * Only the codes a real user can actually cause are translated. Everything else
 * stays generic on purpose: a wrong guess about what went wrong is worse than
 * admitting we do not know, because it sends someone off fixing the wrong thing.
 */
export function explainRejection(error: TransactionRejectedError): string {
  const codes = error.operationCodes;

  if (codes.some((code) => code.endsWith("underfunded"))) {
    return "That is more than you have.";
  }
  if (codes.some((code) => code.endsWith("no_trust") || code.endsWith("no_issuer"))) {
    return "Your wallet is not set up for that yet. Open Deposit once, then try again.";
  }
  if (codes.some((code) => code.endsWith("under_dest_min"))) {
    return "The rate moved while you were confirming. Try that again.";
  }
  if (codes.some((code) => code.endsWith("too_few_offers"))) {
    return "There is not enough being traded right now to convert that much. Try a smaller amount.";
  }
  if (codes.some((code) => code.endsWith("line_full"))) {
    return "That would put more in your wallet than it can hold.";
  }
  if (error.transactionCode === "tx_insufficient_fee") {
    return "The network is busy. Try that again in a moment.";
  }
  return "The network would not accept that. Nothing has moved, so it is safe to try again.";
}

/**
 * One feed out of two sources: what Selkie did, and what the ledger saw.
 *
 * Selkie's own entry always wins a tie. Both describe the same transaction, but
 * only one of them knows it was "from @amaka" rather than from a public key, and
 * only one of them knows a payment is still waiting to be claimed. The ledger is
 * here to fill the gap where Selkie has nothing written down at all.
 */
export function mergeActivity(
  mine: HistoryEntry[],
  deposits: HistoryEntry[],
  limit: number,
): HistoryEntry[] {
  const known = new Set(mine.map((entry) => entry.ref).filter(Boolean));
  const merged = [...mine, ...deposits.filter((entry) => !known.has(entry.ref))];

  // Newest first. Horizon and the store each sort their own results, but
  // interleaving two sorted lists does not keep either one's order.
  merged.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return merged.slice(0, limit);
}

/**
 * Read a handle out of user input. Returns null rather than throwing, because
 * someone typing "@" is a question to answer, not a server error.
 */
function toHandle(input: string, platform: "x" | "telegram"): HandleRef | null {
  const cleaned = input.trim().replace(/^@+/, "");
  return cleaned ? parseHandle(cleaned, platform) : null;
}

/** Does this user actually own the handle a request is addressed to? */
function ownsHandle(user: User, handle: HandleRef): boolean {
  return userHandles(user).some((owned) => handleKey(owned) === handleKey(handle));
}

/** The chain-level account behind a user, for the calls that need one. */
function accountOf(user: User) {
  return {
    chain: "stellar" as const,
    handle: userHandles(user)[0] ?? { platform: "x" as const, username: user.id },
    address: user.address,
    status: "active" as const,
  };
}

/** What the client is allowed to see. No provider subjects, no internals. */
function publicUser(user: User) {
  return {
    id: user.id,
    address: user.address,
    handles: userHandles(user),
    identities: user.identities.map((identity) => ({
      provider: identity.provider,
      username: identity.username,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
    })),
  };
}
