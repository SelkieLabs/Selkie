import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { User } from "../identity/types";
import type { PushStore } from "./store";

/**
 * The push services browsers actually use. Selkie's server POSTs to whatever
 * endpoint a browser hands it, so without this list anyone signed in could
 * point it at an internal address and have the server call it every time
 * they are paid.
 */
const PUSH_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
/** base64url, the encoding browsers give subscription keys in. */
const KEY = /^[A-Za-z0-9_-]{16,200}={0,2}$/;

export function isPushEndpoint(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 1024) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  return PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

export interface PushRouteDeps {
  store: PushStore;
  /** VAPID public key, or null when this server has no push keys. */
  publicKey: string | null;
  requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<User | null>;
}

export function registerPushRoutes(app: FastifyInstance, deps: PushRouteDeps): void {
  /** The key a browser subscribes with. Public on purpose; it only proves messages came from here. */
  app.get("/push/key", async () => ({ publicKey: deps.publicKey }));

  app.post("/push/subscribe", async (request, reply) => {
    const user = await deps.requireUser(request, reply);
    if (!user) return;
    if (!deps.publicKey) return reply.code(503).send({ error: "Notifications are not switched on for this server yet." });
    const body = (request.body ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    const p256dh = body.keys?.p256dh;
    const auth = body.keys?.auth;
    if (!isPushEndpoint(body.endpoint) || typeof p256dh !== "string" || typeof auth !== "string" || !KEY.test(p256dh) || !KEY.test(auth)) {
      return reply.code(400).send({ error: "This browser cannot take notifications from Selkie." });
    }
    await deps.store.save({ endpoint: body.endpoint, userId: user.id, p256dh, auth });
    return { subscribed: true };
  });

  app.post("/push/unsubscribe", async (request, reply) => {
    const user = await deps.requireUser(request, reply);
    if (!user) return;
    const { endpoint } = (request.body ?? {}) as { endpoint?: unknown };
    if (typeof endpoint !== "string") return reply.code(400).send({ error: "Nothing to switch off." });
    await deps.store.remove(endpoint, user.id);
    return { subscribed: false };
  });
}
