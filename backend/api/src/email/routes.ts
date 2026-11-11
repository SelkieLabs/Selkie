import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { User } from "../identity/types";
import { EmailError, type EmailService } from "./service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFF = { available: false, email: null, verified: false, pending: false };

export interface EmailRouteDeps {
  /** Null when this server has no way to send email. */
  service: EmailService | null;
  requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<User | null>;
  /** Rate limit config for routes that send email or check codes. */
  limited: object;
}

export function registerEmailRoutes(app: FastifyInstance, deps: EmailRouteDeps): void {
  const { service } = deps;

  // Mail apps' one-click unsubscribe (RFC 8058) posts a form body; the answer
  // is in the query string, so the body only has to be accepted.
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) =>
      done(null, body),
    );
  }

  /** Run a step that may refuse with words for the person. */
  async function answer(reply: FastifyReply, step: () => Promise<object>) {
    try {
      return { available: true, ...(await step()) };
    } catch (error) {
      if (error instanceof EmailError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  }

  app.get("/email", async (request, reply) => {
    const user = await deps.requireUser(request, reply);
    if (!user) return;
    if (!service) return OFF;
    return { available: true, ...(await service.status(user.id)) };
  });

  /** Start (or restart) proving an address: sends a code to it. */
  app.post("/email", deps.limited, async (request, reply) => {
    const user = await deps.requireUser(request, reply);
    if (!user) return;
    if (!service) return reply.code(503).send({ error: "Email notices are not switched on for this server yet." });
    const { email } = (request.body ?? {}) as { email?: unknown };
    return answer(reply, () => service.start(user.id, email));
  });

  app.post("/email/verify", deps.limited, async (request, reply) => {
    const user = await deps.requireUser(request, reply);
    if (!user) return;
    if (!service) return reply.code(503).send({ error: "Email notices are not switched on for this server yet." });
    const { code } = (request.body ?? {}) as { code?: unknown };
    return answer(reply, () => service.verify(user.id, code));
  });

  app.post("/email/remove", async (request, reply) => {
    const user = await deps.requireUser(request, reply);
    if (!user) return;
    if (!service) return OFF;
    return answer(reply, () => service.remove(user.id));
  });

  /** From an email's link or a mail app's button; no sign-in, the signed link is the proof. */
  app.post("/email/unsubscribe", deps.limited, async (request, reply) => {
    const { u, t } = (request.query ?? {}) as { u?: string; t?: string };
    if (!service || typeof u !== "string" || !UUID.test(u) || typeof t !== "string" || t.length > 100) {
      return reply.code(400).send({ error: "That link is not valid any more." });
    }
    if (!(await service.unsubscribe(u, t))) return reply.code(400).send({ error: "That link is not valid any more." });
    return { stopped: true };
  });
}
