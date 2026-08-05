import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryStateStore } from "../state";
import type { SelkieClient, SendResult } from "../selkie";
import { XApiError } from "./client";
import type { Mention, XClient } from "./client";
import { XWorker } from "./worker";

const SELF = "SelkiePay";

interface Posted {
  text: string;
  inReplyTo: string;
}

/** An X that returns what the test says and records what was posted. */
function fakeX(pages: Mention[][], options: { failReply?: boolean } = {}) {
  const posted: Posted[] = [];
  let page = 0;
  const client = {
    selfId: async () => "1",
    mentions: async () => {
      const mentions = pages[page++] ?? [];
      return { mentions, newestId: mentions.at(-1)?.id ?? null };
    },
    reply: async (text: string, inReplyTo: string) => {
      if (options.failReply) throw new XApiError("no", 403);
      posted.push({ text, inReplyTo });
    },
  } as unknown as XClient;
  return { client, posted };
}

/** A Selkie API that always settles the payment. */
function fakeSelkie(onSend?: (payment: unknown) => void) {
  return {
    send: async (_sender: unknown, payment: unknown): Promise<SendResult> => {
      onSend?.(payment);
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
    assert.match(posted[0]?.text ?? "", /Sent 5 USDC to @bo/);
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
    const { worker, posted } = build([[mention("10", "Sent 5 USDC to @bo", "selkiepay")]], {
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
