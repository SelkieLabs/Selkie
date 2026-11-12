import { createHash } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import {
  AmountError,
  IntentsError,
  RelayRefusedError,
  USDC_DECIMALS,
  assertRelayable,
  isValidAccountId,
  recipientKeyFor,
  relayPolicy,
  toBaseUnits,
  verifySignedDelegate,
  type NearChain,
  type OneClickClient,
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
import { BalanceWatch } from "./balance-watch";
import { NearAccountError, NearIdentityChain } from "./identity-chain";
import { registerEmailRoutes } from "../email/routes";
import type { EmailService } from "../email/service";
import { notifyingActivity, type Notifier } from "../notify/arrival";
import type { PushNotifier } from "../push/notifier";
import { registerPushRoutes } from "../push/routes";
import { InMemoryPushStore, type PushStore } from "../push/store";
import { InMemoryRequestStore, type RequestStore } from "../requests/store";
import { IntentsDesk, intentsErrorStatus, registerIntentsRoutes } from "./intents";
import { CONTRACT_WARNING, NOT_AN_ACCOUNT, NearPayments, type PrepareBody } from "./payments";
import { Refusal } from "./refusal";
import { registerNearRequestRoutes } from "./requests";
import type { NearAccountStore, PrepareStore } from "./store";
import { noXLookup, type XUserLookup } from "./x-lookup";

export interface NearAppDeps {
  users: UserStore;
  provider: IdentityProvider;
  chain: NearChain;
  accounts: NearAccountStore;
  prepares: PrepareStore;
  activity?: ActivityStore;
  requests?: RequestStore;
  xLookup?: XUserLookup;
  limits?: Partial<Record<keyof typeof LIMITS, number>> | false;
  /** Web Push. Without it, money-in notices only show in an open tab. */
  push?: { store: PushStore; notifier: PushNotifier; publicKey: string };
  /** Email notices. Without it, Settings says email is not available. */
  email?: EmailService;
  /** NEAR Intents (1Click). Without it, the other-chain screens say they are switched off. */
  intents?: OneClickClient;
  /** Tests shorten how long outside money must hold before it is written down. */
  watch?: { settleAfterMs?: number; now?: () => number };
}

/** How long a prepared payment may wait for its signature. Matches the delegate's block TTL. */
const PREPARE_TTL_MS = 5 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Reply = FastifyReply;

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
  const feed = deps.activity ?? new InMemoryActivityStore();
  // Every line of money in also goes to the person's phone, when they asked.
  const notifiers: Notifier[] = [deps.push?.notifier, deps.email].filter((notifier) => notifier !== undefined);
  const activity = notifiers.length > 0 ? notifyingActivity(feed, notifiers) : feed;
  const watch = new BalanceWatch({ accounts: deps.accounts, activity, ...deps.watch });
  const near = new NearIdentityChain({ chain, accounts: deps.accounts, watch });
  const identity = new IdentityService({
    users: deps.users,
    provider: deps.provider,
    adapter: near,
    onError: (error) => app.log.error(error),
  });
  const xLookup = deps.xLookup ?? noXLookup;
  const requests = deps.requests ?? new InMemoryRequestStore();
  const policy = relayPolicy({ usdc: config.usdcContract, escrow: config.escrowContract });
  const desk = deps.intents ? new IntentsDesk(deps.intents, config) : null;
  const payments = new NearPayments({
    intents: desk,
    watch,
    chain,
    identity,
    users: deps.users,
    accounts: deps.accounts,
    activity,
    requests,
    xLookup,
  });

  async function requireUser(request: FastifyRequest, reply: Reply): Promise<User | null> {
    const token = bearerToken(request.headers.authorization);
    const result = token ? await identity.signIn(token, { createIfMissing: false }) : null;
    if (!result) {
      reply.code(401).send({ error: "Sign in to continue." });
      return null;
    }
    if (result.claimed.length > 0) await recordClaims(result.user, result.claimed);
    return result.user;
  }

  /** Money that was waiting just landed: one line for the receiver, and the senders stop "waiting". */
  async function recordClaims(user: User, claimed: ClaimOutcome[]): Promise<void> {
    for (const outcome of claimed) {
      for (const amount of outcome.amounts) {
        await activity.record(user.id, { kind: "claim", chain: "near", amount, status: "confirmed", ref: outcome.ref });
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
    await recordClaims(result.user, result.claimed);
    return { status: result.isNew ? "created" : "signed-in", user: publicUser(result.user), claimed: result.claimed };
  });

  app.get("/me", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    await identity.makeWalletReal(user);
    const balance = await near.getBalance(accountOf(user));
    // Reading the balance is when money from outside Selkie gets noticed.
    const usdc = balance.balances.find((entry) => entry.asset === "USDC");
    if (usdc) await watch.check(user, toBaseUnits(usdc.amount, USDC_DECIMALS));
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

  /**
   * People on Selkie whose X handle matches what is being typed into Send.
   *
   * Only for a signed-in caller, only from the third character, and at most six
   * names, so it helps finish a handle you half know without listing everyone.
   * You are never suggested to yourself.
   */
  app.get("/handles", capped("handles"), async (request, reply) => {
    const caller = await requireUser(request, reply);
    if (!caller) return;
    const text = String((request.query as { q?: string }).q ?? "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase();
    if (text.length < 3 || text.length > 30 || !/^[a-z0-9_]+$/.test(text)) return { matches: [] };
    const found = await deps.users.searchHandles("x", text, 7);
    return {
      matches: found
        .filter((match) => match.userId !== caller.id)
        .slice(0, 6)
        .map((match) => ({
          username: match.username,
          displayName: match.displayName,
          avatarUrl: match.avatarUrl,
          nearAccount: match.address,
        })),
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
   * What a NEAR account name points at, before anyone pays it: nothing, a
   * wallet, or a contract that may never send the money back out.
   */
  app.get("/near/accounts/:accountId", capped("handles"), async (request, reply) => {
    const caller = await requireUser(request, reply);
    if (!caller) return;
    const accountId = String((request.params as { accountId?: string }).accountId ?? "").trim().toLowerCase();
    if (!isValidAccountId(accountId)) return reply.code(400).send({ error: NOT_AN_ACCOUNT });
    const kind = await chain.accountKind(accountId);
    const onSelkie = kind !== "missing" && Boolean(await deps.accounts.findByAccountId(accountId));
    return {
      accountId,
      kind,
      onSelkie,
      isYou: accountId === caller.address,
      ...(kind === "contract" ? { warning: CONTRACT_WARNING(accountId) } : {}),
    };
  });

  /**
   * Step one of paying: decide exactly what the user's key will sign.
   *
   * One route for every way money leaves a NEAR account (see PrepareBody): a
   * handle, a NEAR account, many handles, a request, or taking back a payment
   * nobody claimed. The answer is the delegate to sign and what it means.
   */
  app.post("/near/payments/prepare", capped("money"), async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const account = await deps.accounts.findByAccountId(user.address);
    if (!account) return reply.code(409).send({ error: "Your account is still being set up. Sign in again." });

    const planned = await payments.plan(user, (request.body ?? {}) as PrepareBody);
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
    await payments.stillWanted(record.intent);
    const touched = [user.address, ...payments.accountsTouched(record.intent)];
    return watch.around(touched, async () => {
      const outcome = await chain.relay(signed);
      if (outcome.failure) app.log.warn({ tx: outcome.txHash, failure: outcome.failure }, "relayed transaction failed");
      return payments.settle(user, record.intent, outcome);
    });
  });

  registerNearRequestRoutes(app, { requests, requireUser });
  registerPushRoutes(app, {
    store: deps.push?.store ?? new InMemoryPushStore(),
    publicKey: deps.push?.publicKey ?? null,
    requireUser,
  });
  registerEmailRoutes(app, { service: deps.email ?? null, requireUser, limited: capped("auth") });
  registerIntentsRoutes(app, { desk, requireUser, limited: capped("money") });
  // Let notices already on their way finish before the process exits.
  app.addHook("onClose", async () => {
    await Promise.all(notifiers.map((notifier) => notifier.settled()));
  });

  app.get("/activity", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { limit } = (request.query ?? {}) as { limit?: string };
    const parsed = Number(limit);
    const cap = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
    const entries = await activity.list(user.id, { limit: cap });

    // Faces: the X photo of anyone in the list who has signed in to Selkie,
    // looked up once per name. People who have not joined have no photo we
    // hold, and the app draws them a creature instead. A failed lookup only
    // costs a photo, never the list.
    const nameOf = (entry: (typeof entries)[number]) =>
      entry.counterpartyHandle?.platform === "x" ? entry.counterpartyHandle.username.toLowerCase() : null;
    const names = [...new Set(entries.map(nameOf).filter((name): name is string => Boolean(name)))].slice(0, 40);
    const faces = new Map<string, string>();
    await Promise.all(
      names.map(async (name) => {
        try {
          const found = await identity.findByHandle("x", name);
          const url = found?.identities.find(
            (linked) => linked.provider === "x" && linked.username?.toLowerCase() === name,
          )?.avatarUrl;
          if (url) faces.set(name, url);
        } catch {
          // no photo for this one
        }
      }),
    );
    return {
      entries: entries.map((entry) => {
        const face = faces.get(nameOf(entry) ?? "");
        return face ? { ...entry, counterpartyAvatar: face } : entry;
      }),
    };
  });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof IdentityVerificationError) {
      console.warn("[auth]", error.message);
      return reply.code(401).send({ error: "We could not verify that sign-in. Sign in again." });
    }
    if (error instanceof Refusal) return reply.code(error.status).send({ error: error.message, ...error.extra });
    if (error instanceof NearAccountError) return reply.code(400).send({ error: error.message });
    if (error instanceof IntentsError) return reply.code(intentsErrorStatus(error)).send({ error: error.message });
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
