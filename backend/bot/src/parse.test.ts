import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCommand } from "./parse";

const parse = (text: string) => parseCommand(text);

/** Assert this text reads as a payment, and hand back the payment. */
function sent(text: string) {
  const command = parse(text);
  assert.ok(command?.type === "send", `expected "${text}" to read as a payment`);
  return command;
}

/** Assert this text reads as asking someone for money. */
function asked(text: string) {
  const command = parse(text);
  assert.ok(command?.type === "request", `expected "${text}" to read as a request`);
  return command;
}

describe("reading a payment", () => {
  it("reads the plain form", () => {
    assert.deepEqual(parse("@SelkiePay send 5 USDC to @amaka"), {
      type: "send",
      amount: "5",
      asset: "USDC",
      to: "amaka",
      note: undefined,
    });
  });

  it("defaults to dollars when nobody says otherwise", () => {
    assert.equal(sent("@SelkiePay send 5 to @amaka").asset, "USDC");
  });

  it("reads a dollar sign as dollars", () => {
    const command = parse("@SelkiePay pay @amaka $12.50");
    assert.deepEqual(command, {
      type: "send",
      amount: "12.50",
      asset: "USDC",
      to: "amaka",
      note: undefined,
    });
  });

  it("reads the handle-first order, because people write both", () => {
    const command = sent("@SelkiePay send @amaka 5 XLM");
    assert.equal(command.asset, "XLM");
    assert.equal(command.to, "amaka");
  });

  it("accepts pay and transfer as the same instruction", () => {
    for (const verb of ["send", "pay", "transfer"]) {
      assert.equal(parse(`@SelkiePay ${verb} 5 to @amaka`)?.type, "send");
    }
  });

  it("keeps a note", () => {
    assert.equal(sent("@SelkiePay send 5 to @amaka for lunch").note, "for lunch");
  });

  it("lowercases the handle, because @Amaka and @amaka are one person", () => {
    assert.equal(sent("@SelkiePay send 5 to @AMAKA").to, "amaka");
  });

  it("survives line breaks", () => {
    assert.equal(parse("@SelkiePay\nsend 5\nto @amaka")?.type, "send");
  });

  it("is not confused by its own handle appearing twice", () => {
    assert.equal(sent("@SelkiePay hey @SelkiePay send 5 to @amaka").to, "amaka");
  });

  it("keeps the payee when the payee is the bot itself", () => {
    // The exact tweet that went unanswered in testing. Stripping the bot's
    // handle from everywhere erased the recipient and left an instruction with
    // nobody in it, so nothing matched and nothing was said.
    assert.equal(sent("@SelkiePay send 2 USDC to @SelkiePay").to, "selkiepay");
  });

  it("drops the whole run of handles X puts at the front of a reply", () => {
    assert.equal(sent("@SelkiePay @paymesh_ @0xgents send 5 to @amaka").to, "amaka");
  });

  it("reads 'dollars' and 'usd' as USDC, because nobody types the ticker", () => {
    for (const word of ["dollars", "USD", "usdc"]) {
      assert.equal(sent(`@SelkiePay send 5 ${word} to @amaka`).asset, "USDC", word);
    }
  });
});

describe("refusing a payment rather than guessing", () => {
  const refused = (text: string) => {
    const command = parse(text);
    assert.equal(command?.type, "error", `expected "${text}" to be refused`);
  };

  it("refuses an asset it does not know, instead of treating it as dollars", () => {
    // The attack this stops: name a worthless token, have Selkie move the
    // dollar-denominated one because it fell back to a default.
    refused("@SelkiePay send 5 SCAMCOIN to @amaka");
  });

  it("refuses zero and every way of writing it", () => {
    for (const amount of ["0", "0.0", "00", "0.0000000"]) {
      refused(`@SelkiePay send ${amount} to @amaka`);
    }
  });

  it("refuses exponent notation, which no person typing a tweet means", () => {
    // "1e9" reading as a billion would be an expensive misunderstanding.
    assert.notEqual(parse("@SelkiePay send 1e9 to @amaka")?.type, "send");
  });

  it("refuses more decimals than the ledger records", () => {
    assert.notEqual(parse("@SelkiePay send 1.12345678 to @amaka")?.type, "send");
  });

  it("refuses a number too long to be meant", () => {
    assert.notEqual(parse(`@SelkiePay send ${"9".repeat(20)} to @amaka`)?.type, "send");
  });

  it("says it did not understand when the shape is right and the reading is not", () => {
    refused("@SelkiePay send 5 dollars @amaka");
  });

  it("refuses a negative amount", () => {
    assert.notEqual(parse("@SelkiePay send -5 to @amaka")?.type, "send");
  });
});

describe("staying off the timeline", () => {
  it("says nothing to someone merely talking about Selkie", () => {
    assert.equal(parse("@SelkiePay is great, I used it to send money to @amaka yesterday"), null);
  });

  it("says nothing when it is mentioned in passing", () => {
    // Not addressed to us: the message opens with a word of their own, so they
    // are talking to their followers and we are the subject.
    assert.equal(parse("hey @SelkiePay 👋"), null);
  });

  it("introduces itself to somebody who tagged it and nothing else", () => {
    // A bare tag is somebody asking what this is, in the fewest characters
    // possible. It costs one post to answer and looks broken not to.
    assert.deepEqual(parse("@SelkiePay"), { type: "help" });
  });

  it("says nothing to a number with no instruction", () => {
    assert.equal(parse("@SelkiePay 5 USDC"), null);
  });
});

describe("the private commands", () => {
  it("recognises a balance check", () => {
    assert.deepEqual(parse("@SelkiePay balance"), { type: "balance" });
  });

  it("recognises a history check by any of its names", () => {
    for (const word of ["history", "activity", "transactions"]) {
      assert.deepEqual(parse(`@SelkiePay ${word}`), { type: "history" });
    }
  });

  it("reads a payment as a payment even when it mentions balance", () => {
    // Order matters: the money rules run first, so a note cannot turn a
    // payment into a lookup.
    assert.equal(parse("@SelkiePay send 5 to @amaka for balance")?.type, "send");
  });

  it("recognises a request for help", () => {
    for (const text of ["help", "what can you do", "how do i send money"]) {
      assert.equal(parse(`@SelkiePay ${text}`)?.type, "help");
    }
  });
});

describe("asking someone for money", () => {
  it("reads the plain form", () => {
    assert.deepEqual(parse("@SelkiePay request 20 USDC from @amaka"), {
      type: "request",
      amount: "20",
      asset: "USDC",
      from: "amaka",
    });
  });

  it("reads the handle-first order", () => {
    const command = asked("@SelkiePay request @amaka for $20");
    assert.equal(command.from, "amaka");
    assert.equal(command.amount, "20");
  });
});

describe("input nobody should be able to weaponize", () => {
  it("does not hang on a long run of text", () => {
    // A parser that backtracks forever is a way to take the bot down.
    const started = Date.now();
    parse(`@SelkiePay send ${"9".repeat(5000)}${" ".repeat(5000)} to @amaka`);
    assert.ok(Date.now() - started < 1000, "parsing should not take a second");
  });

  it("refuses a handle longer than any platform allows", () => {
    assert.notEqual(parse(`@SelkiePay send 5 to @${"a".repeat(64)}`)?.type, "send");
  });

  it("handles empty and rubbish input without throwing", () => {
    for (const junk of ["", " ", "\n", "@@@@", "send send send"]) {
      assert.doesNotThrow(() => parse(junk));
    }
  });

  it("truncates a note rather than passing an essay to the ledger", () => {
    const command = sent(`@SelkiePay send 5 to @amaka ${"x".repeat(500)}`);
    assert.ok((command.note?.length ?? 0) <= 60);
  });
});

describe("somebody asking what this is", () => {
  const asks = (text: string) => parseCommand(text);

  it("answers the question that was actually asked, not the one we listed", () => {
    // The exact post that got nothing: "what do you do" is not "what can you
    // do", and a payments bot that says nothing when asked what it is looks
    // broken at the moment it is being evaluated.
    assert.deepEqual(asks("@SelkiePay what do you do"), { type: "help" });
  });

  it("answers every ordinary way of asking the same thing", () => {
    const ways = [
      "@SelkiePay what do you do",
      "@SelkiePay what is this",
      "@SelkiePay what is this?",
      "@SelkiePay who are you",
      "@SelkiePay how does this work",
      "@SelkiePay how do i use this",
      "@SelkiePay what can you do",
      "@SelkiePay is this real?",
      "@SelkiePay are you a scam",
      "@SelkiePay can you send money to anyone?",
      "@SelkiePay does this actually work",
      "@SelkiePay explain",
      "@SelkiePay tell me more",
      "@SelkiePay ?",
      "@SelkiePay",
      "@SelkiePay hi",
      "@SelkiePay gm",
      "@SelkiePay hey!",
      "@SelkiePay help",
      "@SelkiePay commands",
    ];

    for (const text of ways) {
      assert.deepEqual(asks(text), { type: "help" }, `no answer to: ${text}`);
    }
  });

  it("still answers when X has stacked other handles in front of us", () => {
    // A reply inside a thread carries every handle in it.
    assert.deepEqual(asks("@someone @SelkiePay @another what is this?"), { type: "help" });
  });

  it("says nothing to a remark, however friendly", () => {
    // Answering these is noise on the timeline and a bill for every post.
    for (const text of [
      "@SelkiePay this is a great app",
      "@SelkiePay nice work team",
      "@SelkiePay congrats on the launch",
      "@SelkiePay 🔥🔥🔥",
    ]) {
      assert.equal(asks(text), null, `answered a remark: ${text}`);
    }
  });

  it("says nothing when people are talking about us to each other", () => {
    // The question opener is only trusted when the message was addressed to us,
    // which on X means it opened with a handle.
    for (const text of [
      "does anyone know if @SelkiePay works?",
      "what is @SelkiePay exactly",
      "how does @SelkiePay make money?",
      "I wonder who built @SelkiePay",
    ]) {
      assert.equal(asks(text), null, `answered a bystander: ${text}`);
    }
  });

  it("still prefers a real instruction over reading it as a question", () => {
    assert.deepEqual(asks("@SelkiePay can you send 5 to @bo?"), {
      type: "send",
      amount: "5",
      asset: "USDC",
      to: "bo",
      note: undefined,
    });
    assert.deepEqual(asks("@SelkiePay what is my balance?"), { type: "balance" });
  });
});

describe("punctuation at the end of an instruction", () => {
  it("reads a payment with a question mark on it", () => {
    // "Can you send 5 to @bo?" is an instruction, not a question. Before this
    // the pattern failed on the "?" and the whole thing became a help card.
    for (const text of [
      "@SelkiePay can you send 5 to @bo?",
      "@SelkiePay send 5 to @bo!",
      "@SelkiePay send 5 to @bo.",
      "@SelkiePay please send 5 to @bo?!",
    ]) {
      assert.deepEqual(
        parseCommand(text),
        { type: "send", amount: "5", asset: "USDC", to: "bo", note: undefined },
        text,
      );
    }
  });

  it("reads the other ordering with punctuation too", () => {
    assert.deepEqual(parseCommand("@SelkiePay pay @bo 5?"), {
      type: "send",
      amount: "5",
      asset: "USDC",
      to: "bo",
      note: undefined,
    });
  });

  it("keeps a note that follows the handle", () => {
    assert.deepEqual(parseCommand("@SelkiePay send 5 to @bo for lunch"), {
      type: "send",
      amount: "5",
      asset: "USDC",
      to: "bo",
      note: "for lunch",
    });
  });
});
