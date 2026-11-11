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
import { toHandle } from "../app";
import type { User } from "../identity/types";
import { userHandles } from "../identity/types";
import type { RequestStore } from "../requests/store";

const NOTE_MAX = 120;

export function registerNearRequestRoutes(
  app: FastifyInstance,
  deps: {
    requests: RequestStore;
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<User | null>;
  },
): void {
  const { requests, requireUser } = deps;
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
    const body = (request.body ?? {}) as { from?: string; amount?: string; note?: string };
    if (!body.from || !body.amount) return reply.code(400).send({ error: "Add a handle and an amount to ask for." });

    const asker = userHandles(user)[0];
    if (!asker) return reply.code(409).send({ error: "Sign in with X before asking for money." });
    const target = toHandle(body.from, "x");
    if (!target) return reply.code(400).send({ error: "That handle is not one we can ask." });
    if (handleKey(target) === handleKey(asker)) {
      return reply.code(400).send({ error: "That is your own handle. Pick someone else." });
    }
    // Normalised now, so whoever pays it signs for exactly the amount shown.
    const units = toPositiveBaseUnits(String(body.amount), USDC_DECIMALS);

    const created = await requests.create({
      fromUserId: user.id,
      fromHandle: asker,
      toHandle: target,
      amount: { amount: fromBaseUnits(units, USDC_DECIMALS), asset: "USDC" },
      note: body.note?.trim().slice(0, NOTE_MAX) || undefined,
    });
    return { status: "asked", request: created, message: `Asked @${target.username}.` };
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
