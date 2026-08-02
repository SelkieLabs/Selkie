import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { StellarAdapter } from "@selkie/chain-stellar";
import type { HandleRef, Money, SwapProvider } from "@selkie/core";
import { parseHandle } from "@selkie/core";
import type { ActivityStore } from "./activity/store";
import { InMemoryActivityStore } from "./activity/store";
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
}

/**
 * The HTTP surface. Thin on purpose: routes parse input, call a service, and
 * shape a response. Every decision that matters lives in IdentityService or the
 * chain adapter, so the bot and the web app get identical behaviour.
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const identity = new IdentityService(deps);
  const activity = deps.activity ?? new InMemoryActivityStore();

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
    const result = await deps.adapter.send(from, to, money, body.note);

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
