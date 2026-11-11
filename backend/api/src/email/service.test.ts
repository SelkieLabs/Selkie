import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { EmailError, EmailService, type OutgoingEmail } from "./service";
import { InMemoryEmailStore } from "./store";

const USER = "8b0f6c2e-1d1a-4c55-9a3e-2f1e0d9c8b7a";
const notice = { title: "Money in", body: "@tunde sent you 2.00 USDC.", url: "/wallet/home", tag: "activity-act_1" };

let sent: OutgoingEmail[];
let clock: number;
let service: EmailService;
let failSends: boolean;

beforeEach(() => {
  sent = [];
  clock = Date.parse("2026-11-11T12:00:00Z");
  failSends = false;
  service = new EmailService({
    store: new InMemoryEmailStore(),
    send: async (email) => {
      if (failSends) throw new Error("provider down");
      sent.push(email);
    },
    webUrl: "https://selkie.test",
    linkSecret: "test-secret",
    now: () => clock,
  });
});

const codeIn = (email: OutgoingEmail) => /\b(\d{6})\b/.exec(email.text)![1]!;
const refusal = (status: number) => (error: unknown) => error instanceof EmailError && error.status === status;

async function proven(address = "amaka@example.com") {
  await service.start(USER, address);
  return service.verify(USER, codeIn(sent.at(-1)!));
}

describe("EmailService", () => {
  test("an address is proven with the code sent to it, and only then gets notices", async () => {
    assert.deepEqual(await service.start(USER, "  amaka@example.com "), { email: "amaka@example.com", verified: false, pending: true });
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.subject, /^\d{6} is your Selkie code$/);

    service.notify(USER, notice);
    await service.settled();
    assert.equal(sent.length, 1, "nothing but the code goes to an unproven address");

    assert.deepEqual(await service.verify(USER, codeIn(sent[0]!)), { email: "amaka@example.com", verified: true, pending: false });
    service.notify(USER, notice);
    await service.settled();
    const mail = sent[1]!;
    assert.equal(mail.to, "amaka@example.com");
    assert.equal(mail.subject, "@tunde sent you 2.00 USDC");
    assert.match(mail.text, /Open your wallet: https:\/\/selkie\.test\/wallet\/home/);
    assert.equal(mail.headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.match(mail.headers!["List-Unsubscribe"]!, /^<https:\/\/selkie\.test\/api\/email\/unsubscribe\?u=/);
    assert.equal(mail.idempotencyKey, `activity-act_1-${USER}`);
  });

  test("bad addresses and too-quick resends are refused", async () => {
    for (const bad of ["", "amaka", "amaka@", "a@b", "a b@example.com", `${"a".repeat(250)}@example.com`, 42]) {
      await assert.rejects(service.start(USER, bad), refusal(400), String(bad));
    }
    await service.start(USER, "amaka@example.com");
    await assert.rejects(service.start(USER, "amaka@example.com"), refusal(429));
    clock += 60_000;
    await service.start(USER, "amaka@example.com");
    assert.equal(sent.length, 2);
  });

  test("wrong, expired and too many codes", async () => {
    await service.start(USER, "amaka@example.com");
    const code = codeIn(sent[0]!);
    const wrong = code === "000000" ? "111111" : "000000";
    await assert.rejects(service.verify(USER, wrong), refusal(400));
    for (let i = 0; i < 4; i++) await assert.rejects(service.verify(USER, wrong), refusal(400));
    await assert.rejects(service.verify(USER, code), refusal(429), "five wrong guesses lock even the right code");

    clock += 60_000;
    await service.start(USER, "amaka@example.com");
    clock += 15 * 60_000 + 1;
    await assert.rejects(service.verify(USER, codeIn(sent[1]!)), refusal(400));
  });

  test("a failed send forgets the address, so trying again is not held up", async () => {
    failSends = true;
    await assert.rejects(service.start(USER, "amaka@example.com"), refusal(502));
    assert.deepEqual(await service.status(USER), { email: null, verified: false, pending: false });
    failSends = false;
    await service.start(USER, "amaka@example.com");
    assert.equal(sent.length, 1);
  });

  test("the link in an email stops them; a forged or old link does not", async () => {
    await proven();
    service.notify(USER, notice);
    await service.settled();
    const link = new URL(/Stop these emails: (\S+)/.exec(sent.at(-1)!.text)![1]!);
    assert.equal(link.pathname, "/email/unsubscribe");
    const token = link.searchParams.get("t")!;

    assert.equal(await service.unsubscribe(USER, token.slice(0, -2) + "AA"), false);
    assert.equal((await service.status(USER)).verified, true);
    assert.equal(await service.unsubscribe(USER, token), true);
    assert.equal((await service.status(USER)).email, null);
    assert.equal(await service.unsubscribe(USER, token), true, "already stopped is still stopped");

    // A new address retires links sent to the old one.
    clock += 60_000;
    await proven("amaka@new.example");
    assert.equal(await service.unsubscribe(USER, token), false);
  });

  test("email text is escaped in the HTML", async () => {
    await proven();
    service.notify(USER, { ...notice, body: "<b>@x</b> sent you 1.00 USDC." });
    await service.settled();
    assert.ok(!sent.at(-1)!.html.includes("<b>@x</b>"));
  });
});
