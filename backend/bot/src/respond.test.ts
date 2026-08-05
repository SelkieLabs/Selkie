import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCommand } from "./parse";
import { respond } from "./respond";
import { SelkieApiError } from "./selkie";
import type { SelkieClient, Sender, SendResult } from "./selkie";

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
function reply(text: string, client: SelkieClient = selkie()): Promise<string | null> {
  return respond(parseCommand(text, { self: "SelkiePay" }), AMAKA, client, { webUrl: WEB });
}

describe("answering a payment", () => {
  it("confirms one that landed", async () => {
    assert.match((await reply("@SelkiePay send 5 to @bo")) ?? "", /Sent 5 USDC to @bo/);
  });

  it("explains one that is waiting, without a word about escrow", async () => {
    const waiting = selkie({ send: async () => ({ ...settled, waitingToBeClaimed: true }) });
    const text = (await reply("@SelkiePay send 5 to @bo", waiting)) ?? "";

    assert.match(text, /waiting for them/i);
    assert.doesNotMatch(text, /escrow|contract|ledger|chain/i);
  });

  it("refuses to pay you yourself, before troubling the API", async () => {
    const client = selkie({
      send: async () => assert.fail("should never reach the API"),
    });
    assert.match((await reply("@SelkiePay send 5 to @amaka", client)) ?? "", /That is you/);
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
      (await respond(parseCommand("@SelkiePay send 5 to @bo", { self: "SelkiePay" }), AMAKA, client, {
        webUrl: WEB,
        onError: (error) => seen.push(error),
      })) ?? "";

    assert.doesNotMatch(text, /sponsor|undefined|TypeError/);
    assert.match(text, /Nothing moved/i, "and says the money is safe, which is what matters");
    assert.equal(seen.length, 1, "the real fault still reaches the log");
  });
});

describe("how it talks", () => {
  const everything = async () => {
    const texts = [
      await reply("@SelkiePay send 5 to @bo"),
      await reply("@SelkiePay balance"),
      await reply("@SelkiePay help"),
      await reply("@SelkiePay request 5 from @bo"),
      await reply("@SelkiePay send 5 dollars @bo"),
    ];
    return texts.filter((text): text is string => text !== null);
  };

  it("uses no crypto words anywhere", async () => {
    for (const text of await everything()) {
      assert.doesNotMatch(text, /trustline|gas|escrow|on-chain|ledger|seed phrase|wallet address/i, text);
    }
  });

  it("fits in a tweet", async () => {
    for (const text of await everything()) {
      assert.ok(text.length <= 280, `too long (${text.length}): ${text}`);
    }
  });

  it("passes the API's own words through, so the bot and the app agree", async () => {
    const client = selkie({
      send: async () => {
        throw new SelkieApiError("That is more than you have.", 400);
      },
    });
    assert.equal(await reply("@SelkiePay send 5 to @bo", client), "That is more than you have.");
  });

  it("says nothing at all when there was no instruction", async () => {
    assert.equal(await reply("@SelkiePay nice work team"), null);
  });

  it("teaches the format when it could not read one", async () => {
    assert.match((await reply("@SelkiePay send 5 dollars @bo")) ?? "", /send 5 to @friend/);
  });

  it("names what it can move when asked for something else", async () => {
    const text = (await reply("@SelkiePay send 5 SCAMCOIN to @bo")) ?? "";
    assert.match(text, /USDC or XLM/);
  });
});
