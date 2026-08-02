import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { StellarAdapter } from "@selkie/chain-stellar";
import type { HandleRef, Money, PaymentResult, SwapProvider } from "@selkie/core";
import { handleKey, parseHandle } from "@selkie/core";
import type { ActivityStore } from "./activity/store";
import { InMemoryActivityStore } from "./activity/store";
import type { RequestStore } from "./requests/store";
import { InMemoryRequestStore } from "./requests/store";
import { bearerToken } from "./auth";
import type { IdentityProvider } from "./identity/provider";
import { IdentityVerificationError } from "./identity/provider";
import type { ClaimOutcome } from "./identity/service";
import { IdentityService } from "./identity/service";
import type { UserStore } from "./identity/store";
import type { IdentityProviderId, User } from "./identity/types";
import { isPayable, userHandles } from "./identity/types";

export interface AppDeps {
  users: UserStore;
  provider: IdentityProvider;
  adapter: StellarAdapter;
  swap: SwapProvider;
  activity?: ActivityStore;
  requests?: RequestStore;
}

/** Paying more people than this at once is a mistake, not a feature. */
const MAX_BATCH = 100;

/**
 * The HTTP surface. Thin on purpose: routes parse input, call a service, and
 * shape a response. Every decision that matters lives in IdentityService or the
 * chain adapter, so the bot and the web app get identical behaviour.
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const identity = new IdentityService(deps);
  const activity = deps.activity ?? new InMemoryActivityStore();
  const requests = deps.requests ?? new InMemoryRequestStore();

  /** Resolve the caller, or reply 401. Returns null when it has already replied. */
  async function requireUser(request: FastifyRequest, reply: {
    code: (n: number) => { send: (body: unknown) => unknown };
  }): Promise<User | null> {
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      reply.code(401).send({ error: "Sign in to continue." });
      return null;
    }
    const result = await identity.signIn(token, { createIfMissing: false });
    if (!result) {
      reply.code(401).send({ error: "Sign in to continue." });
      return null;
    }
    return result.user;
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
      status: result.heldForClaim ? "pending" : "confirmed",
      ref: result.ref,
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
        status: result.heldForClaim ? "pending" : "confirmed",
        ref: result.ref,
      });
    }

    return result;
  }

  /** Money that was waiting and just landed deserves a line in the feed. */
  async function recordClaims(userId: string, claimed: ClaimOutcome[]): Promise<void> {
    for (const outcome of claimed) {
      for (const amount of outcome.amounts) {
        await activity.record(userId, {
          kind: "claim",
          chain: "stellar",
          amount,
          status: "confirmed",
          ref: outcome.ref,
        });
      }
    }
  }

  app.get("/health", async () => ({ ok: true }));

  /**
   * Sign in, or report that this identity is new so the client can ask once
   * before creating an account. That question is what stops one person from
   * ending up with two wallets.
   */
  app.post("/auth/session", async (request, reply) => {
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

    await recordClaims(result.user.id, result.claimed);

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
  app.post("/auth/link", async (request, reply) => {
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

    await recordClaims(result.user.id, result.claimed);
    return { status: "linked", user: publicUser(result.user), claimed: result.claimed };
  });

  /** Confirmed merge. Separate from linking because it moves money. */
  app.post("/auth/merge", async (request, reply) => {
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
  app.get("/handles/:username", async (request, reply) => {
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
  app.post("/payments/send", async (request, reply) => {
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

    const from = userHandles(user)[0];
    if (!from) {
      return reply.code(409).send({
        error: "Link your X or Telegram account before sending.",
      });
    }

    const to = toHandle(body.to, (body.platform ?? "x") as "x" | "telegram");
    if (!to) return reply.code(400).send({ error: "Who are you paying, and how much?" });

    const money: Money = { amount: body.amount, asset: (body.asset ?? "USDC").toUpperCase() };
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

  /**
   * The address to put money into, ready to actually receive it.
   *
   * Not a read: it makes the wallet real on the ledger and opens the trustlines
   * first. An address with no account behind it cannot be paid, and one with no
   * trustline bounces the payment back to the sender. Both of those fail at the
   * sender's end, after the money has left, which is the worst place to find out.
   */
  app.post("/me/receive", async (request, reply) => {
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
  app.post("/requests/:id/pay", async (request, reply) => {
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

    const result = await pay(user, from, found.fromHandle, found.amount, found.note);
    const settled = await requests.settle(id, "paid", result.ref);
    return {
      status: "paid",
      request: settled,
      message: `Paid @${found.fromHandle.username}.`,
    };
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
  app.post("/payments/batch", async (request, reply) => {
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
  app.post("/payments/convert", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const body = (request.body ?? {}) as { from?: string; to?: string; amount?: string };
    if (!body.from || !body.to || !body.amount) {
      return reply.code(400).send({ error: "What are you converting, and how much?" });
    }

    const source: Money = { amount: body.amount, asset: body.from.toUpperCase() };
    const target = body.to.toUpperCase();
    const quote = await deps.swap.quote(source, target);
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

  /** The activity feed. Newest first, already in the order it is shown. */
  app.get("/activity", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const { limit } = (request.query ?? {}) as { limit?: string };
    const parsed = Number(limit);
    const entries = await activity.list(user.id, {
      limit: Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : undefined,
    });
    return { entries };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof IdentityVerificationError) {
      // The reason goes to the log, never to the client: it is how we tell a
      // stale token from a misconfigured app, and it never contains the token.
      console.warn("[auth]", error.message);
      return reply.code(401).send({ error: "That sign-in could not be verified." });
    }
    // Never leak internals to a client; the detail goes to the server log.
    console.error("[api]", error);
    return reply.code(500).send({ error: "Something went wrong on our side." });
  });

  return app;
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
