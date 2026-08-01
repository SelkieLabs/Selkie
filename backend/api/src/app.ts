import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { StellarAdapter } from "@selkie/chain-stellar";
import { parseHandle } from "@selkie/core";
import { bearerToken } from "./auth";
import type { IdentityProvider } from "./identity/provider";
import { IdentityVerificationError } from "./identity/provider";
import { IdentityService } from "./identity/service";
import type { UserStore } from "./identity/store";
import type { User } from "./identity/types";
import { userHandles } from "./identity/types";

export interface AppDeps {
  users: UserStore;
  provider: IdentityProvider;
  adapter: StellarAdapter;
}

/**
 * The HTTP surface. Thin on purpose: routes parse input, call a service, and
 * shape a response. Every decision that matters lives in IdentityService or the
 * chain adapter, so the bot and the web app get identical behaviour.
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const identity = new IdentityService(deps);

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
    const balance = await deps.adapter.getBalance({
      chain: "stellar",
      handle: userHandles(user)[0] ?? { platform: "x", username: user.id },
      address: user.address,
      status: "active",
    });
    return { user: publicUser(user), balances: balance.balances };
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

    const to = parseHandle(body.to, (body.platform ?? "x") as "x" | "telegram");
    const result = await deps.adapter.send(
      from,
      to,
      { amount: body.amount, asset: (body.asset ?? "USDC").toUpperCase() },
      body.note,
    );

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
