import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryStateStore } from "../state";
import type { FollowUp, SelkieClient, SendResult } from "../selkie";
import { XApiError } from "./client";
import type { Mention, RateLimit, XClient } from "./client";
import { XWorker } from "./worker";

const SELF = "SelkiePay";

interface Posted {
  text: string;
  inReplyTo: string;
}

/** An X that returns what the test says and records what was posted. */
function fakeX(
  pages: Mention[][],
  options: { failReply?: boolean; rateLimit?: RateLimit | null } = {},
) {
  const posted: Posted[] = [];
  let page = 0;
  const client = {
    selfId: async () => "1",
    mentions: async () => {
      const mentions = pages[page++] ?? [];
      return {
        mentions,
        newestId: mentions.at(-1)?.id ?? null,
        rateLimit: options.rateLimit ?? null,
      };
    },
    reply: async (text: string, inReplyTo: string) => {
      if (options.failReply) throw new XApiError("no", 403);
      posted.push({ text, inReplyTo });
    },
  } as unknown as XClient;
  return { client, posted };
}

/** A Selkie API that always settles the payment. */
function fakeSelkie(onSend?: (payment: unknown) => void, delayMs = 0) {
  return {
    send: async (_sender: unknown, payment: unknown): Promise<SendResult> => {
      onSend?.(payment);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { status: "confirmed", ref: "r1", message: "Sent.", waitingToBeClaimed: false };
    },
  } as unknown as SelkieClient;
}

function mention(id: string, text: string, authorHandle = "amaka"): Mention {
  return { id, text, authorId: `author-${authorHandle}`, authorHandle };
}

function build(
  pages: Mention[][],
  overrides: Partial<ConstructorParameters<typeof XWorker>[0]> = {},
  fake = fakeX(pages),
) {
  const logs: string[] = [];
  const worker = new XWorker({
    client: fake.client,
    selkie: fakeSelkie(),
    handle: SELF,
    webUrl: "https://selkiepay.vercel.app",
    state: new MemoryStateStore(),
    log: (message) => logs.push(message),
    ...overrides,
  });
  return { worker, posted: fake.posted, logs };
}

describe("the first time it runs", () => {
  it("answers nothing, so its debut is not a reply to every mention ever", async () => {
    const { worker, posted } = build([[mention("10", "@SelkiePay send 5 to @bo")]]);

    const result = await worker.poll();

    assert.equal(result.answered, 0);
    assert.deepEqual(posted, []);
  });

  it("remembers where it got to, so the next poll is not another first run", async () => {
    const state = new MemoryStateStore();
    const { worker } = build([[mention("10", "hello")]], { state });

    await worker.poll();

    assert.equal(state.read().sinceId, "10");
  });
});

describe("once it knows where new starts", () => {
  const started = () => new MemoryStateStore({ sinceId: "1" });

  it("answers a payment", async () => {
    const { worker, posted } = build([[mention("10", "@SelkiePay send 5 to @bo")]], {
      state: started(),
    });

    await worker.poll();

    assert.equal(posted.length, 1);
    assert.equal(posted[0]?.inReplyTo, "10");
    assert.match(posted[0]?.text ?? "", /@bo got 5 USDC/);
  });

  it("passes the payment through as written", async () => {
    const seen: unknown[] = [];
    const { worker } = build([[mention("10", "@SelkiePay send 2.50 XLM to @bo for lunch")]], {
      state: started(),
      selkie: fakeSelkie((payment) => seen.push(payment)),
    });

    await worker.poll();

    assert.deepEqual(seen[0], {
      to: "bo",
      amount: "2.50",
      asset: "XLM",
      note: "for lunch",
      platform: "x",
    });
  });

  it("says nothing to a mention that is not an instruction", async () => {
    const { worker, posted } = build([[mention("10", "@SelkiePay this is a great app")]], {
      state: started(),
    });

    assert.equal((await worker.poll()).answered, 0);
    assert.deepEqual(posted, []);
  });

  it("never answers itself, which would be a conversation with no end", async () => {
    // Its own replies land in its own mentions.
    const { worker, posted } = build([[mention("10", "✅ Sent! @bo got 5 USDC", "selkiepay")]], {
      state: started(),
    });

    await worker.poll();

    assert.deepEqual(posted, []);
  });

  it("handles a mention once, even if it comes back in the next page", async () => {
    const repeated = mention("10", "@SelkiePay send 5 to @bo");
    const { worker, posted } = build([[repeated], [repeated]], { state: started() });

    await worker.poll();
    await worker.poll();

    assert.equal(posted.length, 1);
  });
});

describe("how fast it looks again", () => {
  const started = () => new MemoryStateStore({ sinceId: "1" });
  const quiet = () => new MemoryStateStore({ sinceId: "1" });

  it("is just as quick for the first message as for the second", async () => {
    // The bug this replaced: a slow interval while nobody was talking meant the
    // FIRST message of every conversation waited it out, and every conversation
    // starts with a first message. An empty timeline must not slow us down.
    const quotaForThreeSeconds = { remaining: 300, resetAt: Date.now() + 900_000 };

    const cold = fakeX([[]], { rateLimit: quotaForThreeSeconds });
    const idle = build([], { state: quiet(), pollMs: 15_000, activeMs: 3_000 }, cold);

    const warm = fakeX([[mention("10", "@SelkiePay send 5 to @bo")]], {
      rateLimit: quotaForThreeSeconds,
    });
    const busy = build([], { state: started(), pollMs: 15_000, activeMs: 3_000 }, warm);

    assert.equal((await idle.worker.poll()).nextPollMs, (await busy.worker.poll()).nextPollMs);
  });

  it("slows down when the quota is thin", async () => {
    // 60 reads left with 10 minutes to go is one every 10 seconds. Asking for
    // one every 3 would spend the window in three minutes and then answer
    // nobody for seven.
    const fake = fakeX([[mention("10", "@SelkiePay send 5 to @bo")]], {
      rateLimit: { remaining: 60, resetAt: Date.now() + 600_000 },
    });
    const { worker } = build([], { state: started(), pollMs: 15_000, activeMs: 3_000 }, fake);

    const { nextPollMs } = await worker.poll();

    assert.ok(nextPollMs >= 9_500, `polled every ${nextPollMs}ms, faster than the quota allows`);
  });

  it("uses the speed it is paying for when the quota is generous", async () => {
    // The measured plan: about 300 reads per 15 minutes, which is one every
    // three seconds. Sitting slower than that leaves the plan unused and makes
    // every reply late for no reason.
    const fake = fakeX([[mention("10", "@SelkiePay send 5 to @bo")]], {
      rateLimit: { remaining: 300, resetAt: Date.now() + 900_000 },
    });
    const { worker } = build([], { state: started(), pollMs: 15_000, activeMs: 3_000 }, fake);

    assert.equal((await worker.poll()).nextPollMs, 3_000);
  });

  it("will not poll faster than its floor, however generous the quota looks", async () => {
    const fake = fakeX([[]], { rateLimit: { remaining: 100_000, resetAt: Date.now() + 900_000 } });
    const { worker } = build([], { state: quiet(), pollMs: 15_000, activeMs: 3_000 }, fake);

    assert.equal((await worker.poll()).nextPollMs, 3_000);
  });

  it("waits for the window to refill rather than spending a call on a 429", async () => {
    const fake = fakeX([[]], { rateLimit: { remaining: 0, resetAt: Date.now() + 120_000 } });
    const { worker } = build([], { state: quiet(), pollMs: 15_000, activeMs: 3_000 }, fake);

    const { nextPollMs } = await worker.poll();

    assert.ok(nextPollMs > 15_000, `waited only ${nextPollMs}ms with nothing left to spend`);
  });

  it("ignores a quota reading whose window has already passed", async () => {
    // A stale header or a clock that disagrees must not be turned into a
    // negative interval, which is a tight loop against a metered API.
    const fake = fakeX([[]], { rateLimit: { remaining: 5, resetAt: Date.now() - 10_000 } });
    const { worker } = build([], { state: quiet(), pollMs: 15_000, activeMs: 3_000 }, fake);

    assert.equal((await worker.poll()).nextPollMs, 15_000);
  });

  it("falls back to the slow bound when X reports no quota at all", async () => {
    const fake = fakeX([[]], { rateLimit: null });
    const { worker } = build([], { state: quiet(), pollMs: 15_000, activeMs: 3_000 }, fake);

    assert.equal((await worker.poll()).nextPollMs, 15_000);
  });
});

describe("several people at once", () => {
  const started = () => new MemoryStateStore({ sinceId: "1" });

  it("reports how late it was to a message, so slow can be told from stale", async () => {
    // Our polling being slow and X being slow to show us a post look identical
    // from the outside and have completely different fixes.
    const posted = new Date(Date.now() - 8_000).toISOString();
    const fake = fakeX([
      [{ ...mention("10", "@SelkiePay send 5 to @bo"), createdAt: posted }],
    ]);
    const { worker, logs } = build([], { state: started() }, fake);

    await worker.poll();

    assert.ok(
      logs.some((line) => /oldest posted 8(\.\d)?s ago/.test(line)),
      `no lateness in the log: ${logs.join(" | ")}`,
    );
  });

  it("does not make one person wait behind another's payment", async () => {
    // Payments are the slow part. Handling a batch strictly in order means the
    // last person in it waits for everybody in front of them.
    const fake = fakeX([
      [
        mention("10", "@SelkiePay send 5 to @bo", "amaka"),
        mention("11", "@SelkiePay send 5 to @bo", "chidi"),
        mention("12", "@SelkiePay send 5 to @bo", "dami"),
      ],
    ]);
    const { worker, posted } = build(
      [],
      { state: started(), selkie: fakeSelkie(undefined, 60) },
      fake,
    );

    const startedAt = Date.now();
    await worker.poll();
    const elapsed = Date.now() - startedAt;

    assert.equal(posted.length, 3);
    assert.ok(elapsed < 150, `took ${elapsed}ms, which is one after another rather than together`);
  });

  it("keeps one person's messages strictly in order, one at a time", async () => {
    // Two payments from the same sender share an idempotency key. Running them
    // together would race that guard instead of being caught by it, and the
    // guard is the thing standing between a retry and paying twice.
    let inFlight = 0;
    let overlapped = false;
    const selkie = {
      send: async (_sender: unknown, payment: { to: string }) => {
        overlapped ||= ++inFlight > 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        inFlight--;
        return { status: "confirmed", ref: payment.to, message: "Sent.", waitingToBeClaimed: false };
      },
    } as unknown as SelkieClient;

    const fake = fakeX([
      [
        mention("10", "@SelkiePay send 1 to @bo", "amaka"),
        mention("11", "@SelkiePay send 2 to @bo", "amaka"),
      ],
    ]);
    const { worker } = build([], { state: started(), selkie }, fake);

    await worker.poll();

    assert.equal(overlapped, false, "two payments from one sender ran at the same time");
  });
});

describe("a dry run", () => {
  it("works out the reply and posts nothing", async () => {
    const { worker, posted, logs } = build([[mention("10", "@SelkiePay send 5 to @bo")]], {
      state: new MemoryStateStore({ sinceId: "1" }),
      dryRun: true,
    });

    const result = await worker.poll();

    assert.equal(result.answered, 1, "the reply is still worked out");
    assert.deepEqual(posted, [], "and none of it reaches the timeline");
    assert.ok(logs.some((line) => line.includes("[dry run]")));
  });
});

describe("on NEAR with X pockets", () => {
  /** An API whose pocket always pays, recording who asked for what. */
  function pocketApi() {
    const asked: { sender: { subject: string; username: string; messageId: string }; payment: unknown }[] = [];
    const selkie = {
      pocketSend: async (sender: (typeof asked)[number]["sender"], payment: unknown) => {
        asked.push({ sender, payment });
        return {
          status: "sent",
          txHash: "tx1",
          explorerUrl: "https://explorer.testnet.near.org/transactions/tx1",
          amount: "2",
          to: "bo",
          toAccount: "bo.x.selkiepay.testnet",
          leftToday: "8",
        };
      },
    } as unknown as SelkieClient;
    return { selkie, asked };
  }

  it("pays from the author's pocket, keyed on the mention, and posts the receipt", async () => {
    const { selkie, asked } = pocketApi();
    const { worker, posted } = build([[mention("10", "@SelkiePay send 2 to @bo")]], {
      state: new MemoryStateStore({ sinceId: "1" }),
      chain: "near",
      pocket: true,
      selkie,
    });

    await worker.poll();

    assert.equal(asked.length, 1);
    assert.equal(asked[0]?.sender.subject, "author-amaka", "the author's X id, read off X itself");
    assert.equal(asked[0]?.sender.messageId, "10");
    assert.match(posted[0]?.text ?? "", /^✅ Sent 2 USDC to @bo/);
  });

  it("moves no pocket money in a dry run, where no receipt would be posted", async () => {
    const { selkie, asked } = pocketApi();
    const { worker, logs } = build([[mention("10", "@SelkiePay send 2 to @bo")]], {
      state: new MemoryStateStore({ sinceId: "1" }),
      chain: "near",
      pocket: true,
      dryRun: true,
      selkie,
    });

    await worker.poll();

    assert.equal(asked.length, 0);
    assert.ok(logs.some((line) => line.includes("[dry run]") && line.includes("Check it and send")));
  });
});

describe("when things go wrong", () => {
  it("keeps going when a reply will not post", async () => {
    const fake = fakeX([[mention("10", "@SelkiePay send 5 to @bo")]], { failReply: true });
    const { worker, logs } = build([], { state: new MemoryStateStore({ sinceId: "1" }) }, fake);

    await assert.doesNotReject(() => worker.poll());
    assert.ok(logs.some((line) => line.includes("could not reply")));
  });

  it("waits as long as X asks when it is rate limited", async () => {
    const waits: number[] = [];
    const client = {
      selfId: async () => "1",
      mentions: async () => {
        throw new XApiError("slow down", 429, 90_000);
      },
    } as unknown as XClient;

    const worker = new XWorker({
      client,
      selkie: fakeSelkie(),
      handle: SELF,
      webUrl: "https://selkiepay.vercel.app",
      state: new MemoryStateStore({ sinceId: "1" }),
      log: () => {},
      sleep: async (ms) => {
        waits.push(ms);
        worker.stop();
      },
    });

    await worker.start();

    // The window X named, not the ordinary poll interval.
    assert.deepEqual(waits, [90_000]);
  });

  it("backs off rather than hammering an API that is down", async () => {
    const waits: number[] = [];
    const client = {
      selfId: async () => {
        throw new Error("network down");
      },
    } as unknown as XClient;

    const worker = new XWorker({
      client,
      selkie: fakeSelkie(),
      handle: SELF,
      webUrl: "https://selkiepay.vercel.app",
      state: new MemoryStateStore({ sinceId: "1" }),
      pollMs: 1000,
      log: () => {},
      sleep: async (ms) => {
        waits.push(ms);
        if (waits.length >= 3) worker.stop();
      },
    });

    await worker.start();

    assert.deepEqual(waits, [2000, 4000, 8000], "each failure waits longer than the last");
  });
});

describe("following up in the thread once a link was used to pay", () => {
  const started = () => new MemoryStateStore({ sinceId: "1" });
  const due = (tweetId: string): FollowUp => ({
    tweetId,
    to: "kemi",
    amount: "1.5",
    held: true,
    explorer: "https://testnet.nearblocks.io/txns/abc",
  });

  /** A Selkie API with follow-ups waiting, recording which were marked done. */
  function withFollowUps(waiting: FollowUp[], options: { failRead?: boolean } = {}) {
    const done: string[] = [];
    const selkie = {
      ...fakeSelkie(),
      followUps: async () => {
        if (options.failRead) throw new Error("API down");
        return waiting.filter((f) => !done.includes(f.tweetId));
      },
      followUpDone: async (tweetId: string) => void done.push(tweetId),
    } as unknown as SelkieClient;
    return { selkie, done };
  }

  it("replies in each tweet's thread, then never again", async () => {
    const { selkie, done } = withFollowUps([due("20"), due("21")]);
    const { worker, posted } = build([[], []], { state: started(), selkie, pocket: true, chain: "near" });

    await worker.poll();
    await worker.poll();

    assert.deepEqual(posted.map((p) => p.inReplyTo), ["20", "21"]);
    assert.match(posted[0]!.text, /1\.5 USDC is waiting for @kemi/);
    assert.deepEqual(done, ["20", "21"]);
  });

  it("a rate limit leaves the rest for the next poll", async () => {
    const { selkie, done } = withFollowUps([due("20"), due("21")]);
    let calls = 0;
    const posted: string[] = [];
    const client = {
      selfId: async () => "1",
      mentions: async () => ({ mentions: [], newestId: null, rateLimit: null }),
      reply: async (_text: string, inReplyTo: string) => {
        if (calls++ === 0) throw new XApiError("slow down", 429, 60_000);
        posted.push(inReplyTo);
      },
    } as unknown as XClient;
    const { worker } = build([], { state: started(), selkie, pocket: true, chain: "near" }, { client, posted: [] });

    await worker.poll();
    assert.deepEqual(done, [], "nothing used up by a rate limit");
    await worker.poll();
    assert.deepEqual(posted, ["20", "21"]);
    assert.deepEqual(done, ["20", "21"]);
  });

  it("a reply X will not take is given up on, not retried forever", async () => {
    const { selkie, done } = withFollowUps([due("20")]);
    const fake = fakeX([[]], { failReply: true });
    const { worker, logs } = build([], { state: started(), selkie, pocket: true, chain: "near" }, fake);

    await worker.poll();

    assert.deepEqual(done, ["20"]);
    assert.ok(logs.some((line) => line.includes("could not follow up on 20")));
  });

  it("an API that will not answer is logged, and the poll still succeeds", async () => {
    const { selkie } = withFollowUps([], { failRead: true });
    const { worker, logs } = build([[]], { state: started(), selkie, pocket: true, chain: "near" });

    await assert.doesNotReject(() => worker.poll());
    assert.ok(logs.some((line) => line.includes("could not read follow-ups")));
  });

  it("a dry run, or a bot without the secret, posts none and uses none up", async () => {
    for (const overrides of [{ dryRun: true, pocket: true }, { pocket: false }]) {
      const { selkie, done } = withFollowUps([due("20")]);
      const { worker, posted } = build([[]], { state: started(), selkie, chain: "near", ...overrides });
      await worker.poll();
      assert.deepEqual(posted, []);
      assert.deepEqual(done, []);
    }
  });
});
