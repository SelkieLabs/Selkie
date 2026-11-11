import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { InMemoryActivityStore } from "../activity/store";
import { PushNotifier, arrivalMessage, displayAmount, notifyingActivity } from "./notifier";
import { isPushEndpoint } from "./routes";
import { InMemoryPushStore, MAX_SUBSCRIPTIONS_PER_USER } from "./store";

const sub = (endpoint: string, userId = "u1") => ({ endpoint, userId, p256dh: "p".repeat(87), auth: "a".repeat(22) });
const usdc = (amount: string) => ({ amount, asset: "USDC" });

describe("arrivalMessage", () => {
  test("names who sent it, and what", () => {
    const message = arrivalMessage({ id: "act_1", kind: "receive", status: "confirmed", amount: usdc("2"), counterparty: "@tunde" });
    assert.equal(message?.body, "@tunde sent you 2.00 USDC.");
    assert.equal(message?.tag, "activity-act_1");
    assert.equal(message?.url, "/wallet/home");
  });

  test("money from outside Selkie and money that was waiting", () => {
    const outside = arrivalMessage({ id: "a", kind: "receive", status: "confirmed", amount: usdc("20"), counterparty: "outside Selkie" });
    assert.equal(outside?.body, "20.00 USDC arrived from outside Selkie.");
    const claim = arrivalMessage({ id: "b", kind: "claim", status: "confirmed", amount: usdc("1.5") });
    assert.equal(claim?.body, "1.50 USDC that was waiting for you just landed.");
  });

  test("nothing for money going out, or for a failure", () => {
    assert.equal(arrivalMessage({ id: "a", kind: "send", status: "confirmed", amount: usdc("1"), counterparty: "@a" }), null);
    assert.equal(arrivalMessage({ id: "b", kind: "cashout", status: "confirmed", amount: usdc("1") }), null);
    assert.equal(arrivalMessage({ id: "c", kind: "receive", status: "failed", amount: usdc("1") }), null);
  });

  test("amounts keep every decimal and group thousands, without floats", () => {
    assert.equal(displayAmount("0.000001"), "0.000001");
    assert.equal(displayAmount("1234567.5"), "1,234,567.50");
    assert.equal(displayAmount("100"), "100.00");
  });
});

describe("PushNotifier", () => {
  test("sends to every browser the person turned it on in", async () => {
    const store = new InMemoryPushStore();
    await store.save(sub("https://fcm.googleapis.com/fcm/send/phone"));
    await store.save(sub("https://updates.push.services.mozilla.com/wpush/v2/laptop"));
    await store.save(sub("https://fcm.googleapis.com/fcm/send/someone-else", "u2"));
    const sent: string[] = [];
    const notifier = new PushNotifier({ store, send: async (target, payload) => void sent.push(`${target.endpoint} ${JSON.parse(payload).body}`) });

    notifier.notify("u1", { title: "Money in", body: "hi", url: "/", tag: "t" });
    await notifier.settled();
    assert.deepEqual(sent.sort(), [
      "https://fcm.googleapis.com/fcm/send/phone hi",
      "https://updates.push.services.mozilla.com/wpush/v2/laptop hi",
    ]);
  });

  test("forgets browsers the push service says are gone, and never throws", async () => {
    const store = new InMemoryPushStore();
    await store.save(sub("https://fcm.googleapis.com/fcm/send/gone"));
    await store.save(sub("https://fcm.googleapis.com/fcm/send/flaky"));
    await store.save(sub("https://fcm.googleapis.com/fcm/send/fine"));
    const errors: unknown[] = [];
    const delivered: string[] = [];
    const notifier = new PushNotifier({
      store,
      onError: (error) => errors.push(error),
      send: async (target) => {
        if (target.endpoint.endsWith("gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
        if (target.endpoint.endsWith("flaky")) throw Object.assign(new Error("Unavailable"), { statusCode: 503 });
        delivered.push(target.endpoint);
      },
    });

    notifier.notify("u1", { title: "t", body: "b", url: "/", tag: "t" });
    await notifier.settled();
    assert.deepEqual(delivered, ["https://fcm.googleapis.com/fcm/send/fine"]);
    assert.equal(errors.length, 1, "a 503 is worth a log line");
    assert.deepEqual(
      (await store.forUser("u1")).map((row) => row.endpoint.split("/").pop()).sort(),
      ["fine", "flaky"],
    );
  });

  test("the feed notifies for money in only", async () => {
    const store = new InMemoryPushStore();
    await store.save(sub("https://fcm.googleapis.com/fcm/send/phone"));
    const bodies: string[] = [];
    const notifier = new PushNotifier({ store, send: async (_target, payload) => void bodies.push(JSON.parse(payload).body) });
    const feed = notifyingActivity(new InMemoryActivityStore(), notifier);

    await feed.record("u1", { kind: "send", chain: "near", amount: usdc("1"), counterparty: "@amaka", status: "confirmed" });
    await feed.record("u1", { kind: "receive", chain: "near", amount: usdc("3"), counterparty: "@amaka", status: "confirmed" });
    await notifier.settled();
    assert.deepEqual(bodies, ["@amaka sent you 3.00 USDC."]);
    assert.equal((await feed.list("u1")).length, 2);
  });
});

describe("push subscriptions", () => {
  test("only real push services are accepted as endpoints", () => {
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QGx",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      assert.equal(isPushEndpoint(ok), true, ok);
    }
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost:4100/me",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilpush.apple.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://user:pw@fcm.googleapis.com/x",
      42,
    ]) {
      assert.equal(isPushEndpoint(bad), false, String(bad));
    }
  });

  test("one browser belongs to one person, and each person keeps the newest few", async () => {
    const store = new InMemoryPushStore();
    await store.save(sub("https://fcm.googleapis.com/fcm/send/shared", "u1"));
    await store.save(sub("https://fcm.googleapis.com/fcm/send/shared", "u2"));
    assert.equal((await store.forUser("u1")).length, 0);
    assert.equal((await store.forUser("u2")).length, 1);

    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_USER + 3; i++) await store.save(sub(`https://fcm.googleapis.com/fcm/send/${i}`, "u3"));
    const kept = (await store.forUser("u3")).map((row) => row.endpoint.split("/").pop());
    assert.equal(kept.length, MAX_SUBSCRIPTIONS_PER_USER);
    assert.ok(!kept.includes("0") && kept.includes(String(MAX_SUBSCRIPTIONS_PER_USER + 2)));

    await store.remove("https://fcm.googleapis.com/fcm/send/shared", "u1");
    assert.equal((await store.forUser("u2")).length, 1, "removing needs the owner");
  });
});
