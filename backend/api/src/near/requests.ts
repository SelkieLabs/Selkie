/**
 * Asking someone for money, in NEAR mode.
 *
 * The same rules as on Stellar (requests/store.ts): a request is addressed to a
 * handle, moves nothing by itself, and only the person it names can answer it.
 * Paying one is not here: it goes through prepare -> sign -> relay like every
 * other NEAR payment (`{ requestId }` in /near/payments/prepare), because only
 * the payer's own key can move their money.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { handleKey, type HandleRef } from "@selkie/core";
import { toPositiveBaseUnits, USDC_DECIMALS, fromBaseUnits } from "@selkie/chain-near";
import { toXHandle } from "./x-handle";
import type { User } from "../identity/types";
import { userHandles } from "../identity/types";
import type { RequestStore } from "../requests/store";
import type { UserStore } from "../identity/store";
import { sameSecret, X_ID, type BotAskResult, type BotSendStore } from "./pocket";

const NOTE_MAX = 120;

/** Why an ask cannot be made, as the status and words the web form shows. */
class AskRefused extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export function registerNearRequestRoutes(
  app: FastifyInstance,
  deps: {
    requests: RequestStore;
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<User | null>;
    /**
     * The X bot, so "@SelkiePay request 5 from @amaka" is the ask itself.
     * Without SELKIE_BOT_SECRET the route is off and the bot replies with a link.
     */
    bot?: { secret: string | null; users: UserStore; asks: BotSendStore };
  },
): void {
  const { requests, requireUser } = deps;

  /** The one place an ask is checked and made, for the web form and the bot alike. */
  const ask = async (user: User, body: { from?: unknown; amount?: unknown; note?: unknown }) => {
    const amount = typeof body.amount === "number" ? String(body.amount) : body.amount;
    if (typeof body.from !== "string" || !body.from || typeof amount !== "string" || !amount) {
      throw new AskRefused(400, "Add a handle and an amount to ask for.");
    }
    const asker = userHandles(user)[0];
    if (!asker) throw new AskRefused(409, "Sign in with X before asking for money.");
    const target = toXHandle(body.from);
    if (!target) throw new AskRefused(400, "That handle is not one we can ask.");
    if (handleKey(target) === handleKey(asker)) throw new AskRefused(400, "That is your own handle. Pick someone else.");
    // Normalised now, so whoever pays it signs for exactly the amount shown.
    const units = toPositiveBaseUnits(amount, USDC_DECIMALS);
    const note = typeof body.note === "string" ? body.note.trim().slice(0, NOTE_MAX) : "";
    return requests.create({
      fromUserId: user.id,
      fromHandle: asker,
      toHandle: target,
      amount: { amount: fromBaseUnits(units, USDC_DECIMALS), asset: "USDC" },
      note: note || undefined,
    });
  };
  const notYours = (reply: FastifyReply) =>
    reply.code(404).send({ error: "That request is not waiting for you. It may have been withdrawn." });
  const owns = (user: User, handle: HandleRef) =>
    userHandles(user).some((mine) => handleKey(mine) === handleKey(handle));

  /** Requests waiting on you, and requests you are waiting on. */
  app.get("/requests", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [incoming, outgoing] = await Promise.all([requests.addressedTo(userHandles(user)), requests.sentBy(user.id)]);
    return { incoming, outgoing };
  });

  /** Ask an X handle for dollars. They may not have joined yet; it waits for them. */
  app.post("/requests", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    try {
      const created = await ask(user, (request.body ?? {}) as Record<string, unknown>);
      return { status: "asked", request: created, message: `Asked @${created.toHandle.username}.` };
    } catch (error) {
      if (error instanceof AskRefused) return reply.code(error.code).send({ error: error.message });
      throw error;
    }
  });

  /**
   * The bot asks on someone's behalf because they tweeted it. A request moves
   * no money, so unlike a pocket send there is nothing to cap: it is the same
   * ask the web form makes, from the X account X says wrote the tweet. One ask
   * per tweet, however many times the bot reads it.
   */
  app.post("/near/bot/request", async (request, reply) => {
    const bot = deps.bot;
    if (!bot?.secret) return reply.code(404).send({ error: "Not found." });
    if (!sameSecret(request.headers["x-selkie-bot-secret"], bot.secret)) {
      return reply.code(401).send({ error: "That is not the bot." });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const tweetId = typeof body.tweetId === "string" ? body.tweetId : "";
    const senderXUserId = typeof body.senderXUserId === "string" ? body.senderXUserId : "";
    if (!X_ID.test(tweetId) || !X_ID.test(senderXUserId)) {
      return reply.code(400).send({ error: "A bot request needs the tweet id and its author's X id." });
    }

    const earlier = await bot.asks.begin(tweetId, senderXUserId);
    if (earlier) {
      if (earlier.result && earlier.senderXUserId === senderXUserId) return earlier.result;
      return reply.code(409).send({ error: "That post is already being handled." });
    }

    let result: BotAskResult;
    const user = await bot.users.findByIdentity("x", senderXUserId);
    if (!user) {
      result = { status: "no-account", message: "Sign in to Selkie with X once, then your tweets can ask." };
    } else {
      try {
        const created = await ask(user, { from: body.from, amount: body.amount, note: body.note });
        result = { status: "asked", id: created.id, from: created.toHandle.username, amount: created.amount.amount };
      } catch (error) {
        if (!(error instanceof AskRefused)) console.error("[requests] bot ask", error instanceof Error ? error.message : error);
        result = { status: "failed", message: error instanceof AskRefused ? error.message : "That ask did not go through." };
      }
    }
    await bot.asks.finish(tweetId, result);
    return result;
  });

  /** Turn a request down. Only the person it was addressed to. */
  app.post("/requests/:id/decline", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const found = await requests.get(id).catch(() => null);
    if (!found || !owns(user, found.toHandle)) return notYours(reply);
    if (found.status !== "pending") return reply.code(409).send({ error: "That request has already been answered." });
    return { status: "declined", request: await requests.settle(id, "declined") };
  });

  /** Withdraw a request you sent. Only the asker. */
  app.post("/requests/:id/cancel", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const found = await requests.get(id).catch(() => null);
    if (!found || found.fromUserId !== user.id) {
      return reply.code(404).send({ error: "Only the person who asked can withdraw it." });
    }
    if (found.status !== "pending") return reply.code(409).send({ error: "That request has already been answered." });
    return { status: "cancelled", request: await requests.settle(id, "cancelled") };
  });
}
