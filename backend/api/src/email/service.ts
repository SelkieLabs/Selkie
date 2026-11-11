import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { ArrivalNotice, Notifier } from "../notify/arrival";
import type { EmailStore } from "./store";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  /** The provider drops a second send with the same key (retries, double delivery). */
  idempotencyKey?: string;
}

/** Hand one email to a provider. Throws if it was not accepted. */
export type EmailSend = (email: OutgoingEmail) => Promise<void>;

/** Resend's HTTP API (resend.com/docs/api-reference/emails/send-email). One call, no SDK. */
export function resendSender(config: { apiKey: string; from: string }): EmailSend {
  return async (email) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        ...(email.idempotencyKey ? { "idempotency-key": email.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: config.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: email.headers,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      throw new Error(`Resend refused the email (${response.status}): ${detail}`);
    }
  };
}

/** Local development without a provider: the email is printed, so a code can still be read. */
export const logSender: EmailSend = async (email) => {
  console.log(`[email] to ${email.to}: ${email.subject}\n${email.text}\n`);
};

/** Something the person can fix, with the HTTP status to answer with. */
export class EmailError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface EmailStatus {
  email: string | null;
  verified: boolean;
  /** A code was sent and has not come back yet. */
  pending: boolean;
}

const CODE_TTL_MS = 15 * 60_000;
const RESEND_AFTER_MS = 60_000;
const MAX_ATTEMPTS = 5;
const ADDRESS = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Email notices when money comes in.
 *
 * X sign-in gives Selkie no email address, so the person types one in and
 * proves it with a six-digit code sent to it. Nothing but that code is ever
 * sent to an address that has not been proven, so nobody can point Selkie's
 * mail at someone else's inbox.
 *
 * Every notice carries a signed one-click unsubscribe link (and the
 * List-Unsubscribe headers mail apps use for their own button), so stopping
 * them never needs a sign-in.
 */
export class EmailService implements Notifier {
  readonly #inFlight = new Set<Promise<void>>();
  readonly #now: () => number;

  constructor(
    private readonly deps: {
      store: EmailStore;
      send: EmailSend;
      /** The web app, for links in emails. */
      webUrl: string;
      /** Signs unsubscribe links. */
      linkSecret: string;
      now?: () => number;
      onError?: (error: unknown) => void;
    },
  ) {
    this.#now = deps.now ?? Date.now;
  }

  async status(userId: string): Promise<EmailStatus> {
    const row = await this.deps.store.get(userId);
    if (!row) return { email: null, verified: false, pending: false };
    return { email: row.email, verified: row.verifiedAt !== null, pending: row.verifiedAt === null && row.codeHash !== null };
  }

  /** Send a code to a new address (or the same one again). */
  async start(userId: string, raw: unknown): Promise<EmailStatus> {
    const email = typeof raw === "string" ? raw.trim() : "";
    if (email.length > 254 || !ADDRESS.test(email)) throw new EmailError(400, "Enter an email address like name@example.com.");
    const existing = await this.deps.store.get(userId);
    const now = this.#now();
    if (existing?.codeSentAt && now - Date.parse(existing.codeSentAt) < RESEND_AFTER_MS) {
      throw new EmailError(429, "A code is on its way. Wait a minute before asking for another.");
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.deps.store.startVerification(
      userId,
      email,
      codeHash(userId, email, code),
      new Date(now + CODE_TTL_MS).toISOString(),
      new Date(now).toISOString(),
    );
    try {
      await this.deps.send(codeEmail(email, code));
    } catch (error) {
      // Forget it, so trying again (or a corrected address) is not held up by the wait.
      await this.deps.store.remove(userId);
      this.deps.onError?.(error);
      throw new EmailError(502, "We could not send to that address. Check it and try again.");
    }
    return this.status(userId);
  }

  async verify(userId: string, raw: unknown): Promise<EmailStatus> {
    const code = typeof raw === "string" ? raw.replace(/\s/g, "") : "";
    const row = await this.deps.store.get(userId);
    if (!row?.codeHash || !row.codeExpiresAt) throw new EmailError(400, "Ask for a new code first.");
    if (this.#now() > Date.parse(row.codeExpiresAt)) throw new EmailError(400, "That code expired. Ask for a new one.");
    if (row.codeAttempts >= MAX_ATTEMPTS) throw new EmailError(429, "Too many wrong codes. Ask for a new one.");
    if (!/^\d{6}$/.test(code) || !sameHex(codeHash(userId, row.email, code), row.codeHash)) {
      await this.deps.store.failedAttempt(userId);
      throw new EmailError(400, "That code is not right. Check the email and try again.");
    }
    await this.deps.store.confirm(userId, new Date(this.#now()).toISOString());
    return this.status(userId);
  }

  async remove(userId: string): Promise<EmailStatus> {
    await this.deps.store.remove(userId);
    return this.status(userId);
  }

  /** From the link in an email. True when emails have stopped (including "already had"). */
  async unsubscribe(userId: string, token: string): Promise<boolean> {
    const row = await this.deps.store.get(userId);
    if (!row) return true;
    if (!sameHex(Buffer.from(this.#token(userId, row.email), "base64url").toString("hex"), Buffer.from(token, "base64url").toString("hex"))) {
      return false;
    }
    await this.deps.store.remove(userId);
    return true;
  }

  notify(userId: string, notice: ArrivalNotice): void {
    const job = this.#deliver(userId, notice).finally(() => this.#inFlight.delete(job));
    this.#inFlight.add(job);
  }

  async settled(): Promise<void> {
    while (this.#inFlight.size > 0) await Promise.allSettled([...this.#inFlight]);
  }

  async #deliver(userId: string, notice: ArrivalNotice): Promise<void> {
    try {
      const row = await this.deps.store.get(userId);
      if (!row?.verifiedAt) return;
      const query = `u=${encodeURIComponent(userId)}&t=${this.#token(userId, row.email)}`;
      await this.deps.send(
        arrivalEmail(row.email, notice, {
          wallet: `${this.deps.webUrl}${notice.url}`,
          // The page asks before stopping: mail scanners open links, and must not unsubscribe anyone.
          stop: `${this.deps.webUrl}/email/unsubscribe?${query}`,
          // RFC 8058 one-click: mail apps POST here from their own unsubscribe button.
          oneClick: `${this.deps.webUrl}/api/email/unsubscribe?${query}`,
          idempotencyKey: `${notice.tag}-${userId}`,
        }),
      );
    } catch (error) {
      this.deps.onError?.(error);
    }
  }

  /** Bound to the address too: changing your email retires every old link. */
  #token(userId: string, email: string): string {
    return createHmac("sha256", this.deps.linkSecret).update(`unsubscribe\n${userId}\n${email}`).digest("base64url");
  }
}

function codeHash(userId: string, email: string, code: string): string {
  return createHash("sha256").update(`${userId}\n${email}\n${code}`).digest("hex");
}

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function frame(inner: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f3ec">
<div style="font-family:${FONT};max-width:480px;margin:0 auto;padding:32px 24px;color:#131a21">
${inner}
<p style="font-size:12px;line-height:1.6;color:#6b7280;margin:32px 0 0">${footer}</p>
</div></body></html>`;
}

export function codeEmail(to: string, code: string): OutgoingEmail {
  return {
    to,
    subject: `${code} is your Selkie code`,
    text: [
      `Your Selkie code is ${code}.`,
      "",
      "Enter it in Selkie to get an email whenever money comes in. It expires in 15 minutes.",
      "",
      "If you did not ask for this, ignore this email. Nothing happens without the code.",
    ].join("\n"),
    html: frame(
      `<p style="font-size:15px;margin:0 0 12px">Your Selkie code is</p>
<p style="font-size:34px;font-weight:700;letter-spacing:0.2em;margin:0 0 16px">${code}</p>
<p style="font-size:15px;line-height:1.6;margin:0">Enter it in Selkie to get an email whenever money comes in. It expires in 15 minutes.</p>`,
      "If you did not ask for this, ignore this email. Nothing happens without the code.",
    ),
  };
}

export function arrivalEmail(
  to: string,
  notice: ArrivalNotice,
  links: { wallet: string; stop: string; oneClick: string; idempotencyKey: string },
): OutgoingEmail {
  return {
    to,
    subject: notice.body.replace(/\.$/, ""),
    text: [notice.body, "", `Open your wallet: ${links.wallet}`, "", `Stop these emails: ${links.stop}`].join("\n"),
    html: frame(
      `<p style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8f6526;margin:0 0 8px">${escape(notice.title)}</p>
<p style="font-size:22px;font-weight:700;line-height:1.35;margin:0 0 24px">${escape(notice.body)}</p>
<a href="${escape(links.wallet)}" style="display:inline-block;background:#131a21;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:999px">Open your wallet</a>`,
      `You get this because you turned on email notices in Selkie. <a href="${escape(links.stop)}" style="color:#6b7280">Stop these emails</a>.`,
    ),
    headers: { "List-Unsubscribe": `<${links.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    idempotencyKey: links.idempotencyKey,
  };
}
