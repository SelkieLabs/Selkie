import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCommand } from "./parse";
import { respond } from "./respond";
import { SelkieApiError } from "./selkie";
import type { SelkieClient, Sender, SendResult } from "./selkie";
import { weigh, MAX_WEIGHT } from "./text";

const AMAKA: Sender = { platform: "x", subject: "111", username: "amaka" };
const WEB = "https://selkiepay.vercel.app";

const settled: SendResult = {
  status: "confirmed",
  ref: "r1",
  message: "Sent.",
  waitingToBeClaimed: false,
};

function selkie(overrides: Partial<Record<"send" | "request", unknown>> = {}): SelkieClient {
  return {
    send: async () => settled,
    request: async () => ({ id: "req1" }),
    ...overrides,
  } as unknown as SelkieClient;
}

/** Parse and answer, the way a surface does. */
function reply(
  text: string,
  client: SelkieClient = selkie(),
  now?: () => number,
): Promise<string | null> {
  return respond(parseCommand(text), AMAKA, client, { webUrl: WEB, self: "SelkiePay", now });
}

/** A clock that jumps a fixed amount the second time it is read. */
function stopwatch(elapsedMs: number): () => number {
  let reads = 0;
  return () => (reads++ === 0 ? 1_000_000 : 1_000_000 + elapsedMs);
}

describe("answering a payment", () => {
  it("confirms one that landed, as a receipt rather than a sentence", async () => {
    const text = (await reply("@SelkiePay send 5 to @bo")) ?? "";

    assert.match(text, /^✅ Sent!/, "the outcome first, before any detail");
    assert.match(text, /@bo got 5 USDC/);
    assert.match(text, /selkiepay\.vercel\.app/, "and a link, which X renders as a card");
  });

  it("says how long the money took", async () => {
    const text = (await reply("@SelkiePay send 5 to @bo", selkie(), stopwatch(4200))) ?? "";
    assert.match(text, /Done in 4\.2 seconds/);
  });

  it("says 'under a second' rather than printing a fraction", async () => {
    const text = (await reply("@SelkiePay send 5 to @bo", selkie(), stopwatch(340))) ?? "";
    assert.match(text, /under a second/);
  });

  it("drops the decimal once the wait is long enough that nobody cares", async () => {
    const text = (await reply("@SelkiePay send 5 to @bo", selkie(), stopwatch(13_400))) ?? "";
    assert.match(text, /Done in 13 seconds/);
    assert.doesNotMatch(text, /13\.4/);
  });

  it("explains one that is waiting, without a word about escrow", async () => {
    const waiting = selkie({ send: async () => ({ ...settled, waitingToBeClaimed: true }) });
    const text = (await reply("@SelkiePay send 5 to @bo", waiting)) ?? "";

    assert.match(text, /waiting for them/i);
    assert.match(text, /set aside for @bo/);
    assert.match(text, /sign in with X/i, "and says exactly what they have to do");
    assert.doesNotMatch(text, /escrow|contract|ledger|chain/i);
  });

  it("does not print a timing on a payment that has not arrived yet", async () => {
    // It is waiting to be claimed. Saying it was "done in 4 seconds" would be
    // telling somebody their friend has the money when nobody does yet.
    const waiting = selkie({ send: async () => ({ ...settled, waitingToBeClaimed: true }) });
    const text = (await reply("@SelkiePay send 5 to @bo", waiting, stopwatch(4200))) ?? "";
    assert.doesNotMatch(text, /Done in/);
  });

  it("refuses to pay you yourself, before troubling the API", async () => {
    const client = selkie({
      send: async () => assert.fail("should never reach the API"),
    });
    assert.match((await reply("@SelkiePay send 5 to @amaka", client)) ?? "", /That is you/);
  });

  it("says so when somebody tries to pay the bot, rather than going quiet", async () => {
    // People try this first, to see whether the thing works at all. Silence
    // reads as broken.
    const client = selkie({
      send: async () => assert.fail("should never reach the API"),
    });
    const text = (await reply("@SelkiePay send 2 USDC to @SelkiePay", client)) ?? "";

    assert.match(text, /That one is me/);
    assert.match(text, /friend/i, "and points somewhere useful");
  });

  it("says so when somebody asks the bot for money", async () => {
    const client = selkie({
      request: async () => assert.fail("should never reach the API"),
    });
    assert.match((await reply("@SelkiePay request 5 from @SelkiePay", client)) ?? "", /That one is me/);
  });
});

describe("answering a request for money", () => {
  it("confirms it and says nothing has moved", async () => {
    const text = (await reply("@SelkiePay request 5 from @bo")) ?? "";

    assert.match(text, /^🙋 Ask sent!/);
    assert.match(text, /asked @bo for 5 USDC/i);
    assert.match(text, /Nothing moves until they say yes/i, "the whole security model, in one line");
  });
});

describe("answering someone with no account yet", () => {
  it("invites them in rather than reporting a failure", async () => {
    const client = selkie({
      send: async () => {
        throw new SelkieApiError("Sign in to continue.", 401);
      },
    });
    const text = (await reply("@SelkiePay send 5 to @bo", client)) ?? "";

    assert.match(text, /wallet first/i);
    assert.match(text, /@amaka/, "tells them which account to sign in as");
    assert.match(text, /1\./, "and gives them numbered steps rather than a paragraph");
    assert.doesNotMatch(text, /error|failed|unauthorized/i);
  });
});

describe("what is never said in public", () => {
  it("will not put a balance on the timeline", async () => {
    const text = (await reply("@SelkiePay balance")) ?? "";
    assert.match(text, /stays private/i);
    assert.doesNotMatch(text, /\d/, "not so much as a digit of it");
  });

  it("will not put a history on the timeline", async () => {
    assert.match((await reply("@SelkiePay activity")) ?? "", /stays private/i);
  });

  it("never repeats an internal fault to the person reading", async () => {
    const seen: unknown[] = [];
    const client = selkie({
      send: async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'sponsor')");
      },
    });
    const text =
      (await respond(parseCommand("@SelkiePay send 5 to @bo"), AMAKA, client, {
        webUrl: WEB,
        onError: (error) => seen.push(error),
      })) ?? "";

    assert.doesNotMatch(text, /sponsor|undefined|TypeError/);
    assert.match(text, /did not move/i, "and says the money is safe, which is what matters");
    assert.equal(seen.length, 1, "the real fault still reaches the log");
  });
});

describe("help", () => {
  it("lists every command, as something to copy rather than to read about", async () => {
    const text = (await reply("@SelkiePay help")) ?? "";

    assert.match(text, /send 5 to @friend/);
    assert.match(text, /request 5 from @friend/);
    assert.match(text, /balance/);
    assert.match(text, /activity/);
  });

  it("says the thing that makes it worth using", async () => {
    const text = (await reply("@SelkiePay help")) ?? "";
    assert.match(text, /no app and no wallet/i);
    assert.match(text, /waits for them/i);
  });

  it("points at the documentation for anything a tweet cannot hold", async () => {
    assert.match((await reply("@SelkiePay help")) ?? "", /selkiepay\.vercel\.app\/docs/);
  });
});

describe("how it talks", () => {
  const everything = async () => {
    const texts = await Promise.all([
      reply("@SelkiePay send 5 to @bo"),
      reply("@SelkiePay send 5 to @bo", selkie({ send: async () => ({ ...settled, waitingToBeClaimed: true }) })),
      reply("@SelkiePay balance"),
      reply("@SelkiePay activity"),
      reply("@SelkiePay help"),
      reply("@SelkiePay request 5 from @bo"),
      reply("@SelkiePay send 5 dollars @bo"),
      reply("@SelkiePay send 5 SCAMCOIN to @bo"),
      reply("@SelkiePay send 5 to @amaka"),
      reply("@SelkiePay send 2 to @SelkiePay"),
      reply(
        "@SelkiePay send 5 to @bo",
        selkie({
          send: async () => {
            throw new SelkieApiError("Sign in to continue.", 401);
          },
        }),
      ),
    ]);
    return texts.filter((text): text is string => text !== null);
  };

  it("uses no crypto words anywhere", async () => {
    for (const text of await everything()) {
      assert.doesNotMatch(text, /trustline|gas|escrow|on-chain|ledger|seed phrase|wallet address/i, text);
    }
  });

  it("promises no privacy it cannot deliver", async () => {
    // A public network is public. The one thing Selkie really does keep private
    // is a balance, and that claim is made only where it is true.
    for (const text of await everything()) {
      if (/stays private/i.test(text)) continue;
      assert.doesNotMatch(text, /private|nobody can see|only you/i, text);
    }
  });

  it("fits in a tweet, measured the way X measures it", async () => {
    for (const text of await everything()) {
      const width = weigh(text);
      assert.ok(width <= MAX_WEIGHT, `${width} wide, over the limit:\n${text}`);
    }
  });

  it("opens with an emoji, so the outcome reads at a glance", async () => {
    for (const text of await everything()) {
      assert.match(text, /^[^\w\s]/u, `starts with a word instead of a mark:\n${text}`);
    }
  });

  it("never leaves a stray blank line", async () => {
    for (const text of await everything()) {
      assert.doesNotMatch(text, /\n\n\n/, text);
      assert.doesNotMatch(text, /\s$/, text);
    }
  });

  it("passes the API's own words through, so the bot and the app agree", async () => {
    const client = selkie({
      send: async () => {
        throw new SelkieApiError("That is more than you have.", 400);
      },
    });
    assert.match((await reply("@SelkiePay send 5 to @bo", client)) ?? "", /That is more than you have\./);
  });

  it("says nothing at all when there was no instruction", async () => {
    assert.equal(await reply("@SelkiePay nice work team"), null);
  });

  it("teaches the format when it could not read one", async () => {
    assert.match((await reply("@SelkiePay send 5 dollars @bo")) ?? "", /send 5 to @friend/);
  });

  it("names what it can move when asked for something else", async () => {
    const text = (await reply("@SelkiePay send 5 SCAMCOIN to @bo")) ?? "";
    assert.match(text, /USDC and XLM/);
  });
});
