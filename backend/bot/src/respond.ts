import type { Command } from "./parse";
import { SelkieApiError } from "./selkie";
import type { SelkieClient, Sender } from "./selkie";
import { cap, lines } from "./text";

/**
 * What a message turns into.
 *
 * Surface-agnostic on purpose: X and Telegram differ in how a message arrives
 * and how a reply is posted, never in what it means. Everything here is a plain
 * string, so adding Telegram is a new transport and nothing else.
 *
 * Four rules shape every line below.
 *
 * A reply is a receipt, not a sentence. It opens with what happened, then gives
 * the facts one to a line, then a link. Somebody reading a timeline on a phone
 * takes it in at a glance instead of parsing a paragraph.
 *
 * Nothing private is ever said in public. A balance and a history belong in the
 * app, not on a timeline where the whole internet reads them, so the reply is a
 * pointer rather than an answer. This is not squeamishness: a public balance is
 * a public invitation to whoever wants to take it.
 *
 * Nothing here talks like a crypto app. Nobody is told about trustlines, gas,
 * escrow, or a ledger. They are told their money was sent and that their friend
 * can pick it up, because that is what happened.
 *
 * Nothing here claims more than is true. Selkie sponsors the network fee, so
 * "no fees" is honest. It does not hide a payment from the world, so no reply
 * says it is private. A payments bot that oversells is one screenshot away from
 * being the story.
 */

export interface RespondOptions {
  /** Where people are sent to open their wallet. */
  webUrl: string;
  /**
   * The bot's own handle, so it can tell somebody they are paying the bot.
   *
   * People try this immediately, and it is the friendliest possible mistake:
   * they are testing whether the thing works. Silence reads as broken.
   */
  self?: string;
  /** Called with anything unexpected. Never shown to the person. */
  onError?: (error: unknown) => void;
  /** Read once per reply, so a test can pin the timing it prints. */
  now?: () => number;
}

export async function respond(
  command: Command | null,
  sender: Sender,
  selkie: SelkieClient,
  options: RespondOptions,
): Promise<string | null> {
  // Not a command. Say nothing: most mentions of a payments bot are people
  // talking about it, and a reply to each would be noise and a bill.
  if (!command) return null;

  const site = new Site(options.webUrl);

  switch (command.type) {
    case "balance":
      return cap(privately("balance", site));

    case "history":
      return cap(privately("history", site));

    case "help":
      return cap(helpText(site));

    case "error":
      return cap(explain(command.reason, site));

    case "send":
      if (isSelf(command.to, options.self)) {
        return cap(
          lines("🙂 That one is me!", "", "Name a friend and I will send it to them.", "", `Try: send 5 to @friend`),
        );
      }
      return cap(await sendMoney(command, sender, selkie, site, options));

    case "request":
      if (isSelf(command.from, options.self)) {
        return cap(
          lines("🙂 That one is me, and I have nothing of my own.", "", "Ask a friend instead.", "", "Try: request 5 from @friend"),
        );
      }
      return cap(await askFor(command, sender, selkie, site, options));
  }
}

/**
 * The two links a reply ever uses, without the scheme.
 *
 * X strips `https://` from the display anyway, and the bare domain still gets
 * linked and still renders the card underneath the reply, which is the part
 * that makes a receipt look like a receipt.
 */
class Site {
  readonly home: string;
  readonly docs: string;

  constructor(webUrl: string) {
    this.home = webUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    this.docs = `${this.home}/docs`;
  }
}

async function sendMoney(
  command: Extract<Command, { type: "send" }>,
  sender: Sender,
  selkie: SelkieClient,
  site: Site,
  options: RespondOptions,
): Promise<string> {
  if (command.to === sender.username) {
    return lines("🙂 That is you!", "", "Pick someone else and I will send it.", "", "Try: send 5 to @friend");
  }

  const clock = options.now ?? Date.now;
  const startedAt = clock();

  try {
    const result = await selkie.send(sender, {
      to: command.to,
      amount: command.amount,
      asset: command.asset,
      note: command.note,
      platform: sender.platform,
    });

    const money = `${command.amount} ${command.asset}`;

    if (result.waitingToBeClaimed) {
      return lines(
        "📬 Sent, and waiting for them",
        "",
        `💸 ${money} is set aside for @${command.to}`,
        "🔑 It is theirs the moment they sign in with X",
        "🤝 Nobody holds it in the meantime, not even us",
        "",
        `🔗 ${site.home}`,
      );
    }

    return lines(
      "✅ Sent!",
      "",
      `💸 @${command.to} got ${money}`,
      `⚡ Done in ${took(clock() - startedAt)}`,
      "🎁 No fees, and nothing for them to install",
      "",
      `🔗 ${site.home}`,
    );
  } catch (error) {
    return trouble(error, sender, site, options.onError);
  }
}

async function askFor(
  command: Extract<Command, { type: "request" }>,
  sender: Sender,
  selkie: SelkieClient,
  site: Site,
  options: RespondOptions,
): Promise<string> {
  if (command.from === sender.username) {
    return lines("🙂 That is you!", "", "Name someone else and I will pass it on.", "", "Try: request 5 from @friend");
  }

  try {
    await selkie.request(sender, {
      from: command.from,
      amount: command.amount,
      asset: command.asset,
      platform: sender.platform,
    });

    return lines(
      "🙋 Ask sent!",
      "",
      `💌 You asked @${command.from} for ${command.amount} ${command.asset}`,
      "🔔 They will see it the moment they open Selkie",
      "👋 Nothing moves until they say yes",
      "",
      `🔗 ${site.home}`,
    );
  } catch (error) {
    return trouble(error, sender, site, options.onError);
  }
}

/**
 * The answer to anything that would put someone's money on a public timeline.
 *
 * Not a refusal and not a lecture. It says where the answer is, because the
 * person asking wants the number and the right response is to hand them the
 * door rather than explain the policy.
 */
function privately(what: "balance" | "history", site: Site): string {
  return lines(
    "🔒 That one stays private",
    "",
    `Your ${what} is never posted in public, not even by me.`,
    "",
    `🔗 It is waiting for you at ${site.home}`,
  );
}

/**
 * What Selkie can do, in the space of one tweet.
 *
 * Every line is a command someone can copy, because a list of capabilities is
 * something to read and a list of commands is something to use. The rest is one
 * sentence on the thing that makes it worth using at all, and a door to the
 * full documentation for anybody who wants more than a tweet.
 */
function helpText(site: Site): string {
  return lines(
    "👋 I move money by handle. Try any of these:",
    "",
    "💸 send 5 to @friend",
    "🙋 request 5 from @friend",
    "💰 balance",
    "📜 activity",
    "",
    "They need no app and no wallet. If they have not joined, it waits for them.",
    "",
    `📖 Everything else: ${site.docs}`,
  );
}

/**
 * What to say when it did not work.
 *
 * The API already writes its refusals for people rather than for developers, so
 * they are passed through as they are. Only two cases are rewritten here: not
 * having an account, which is an invitation rather than an error, and anything
 * we did not expect, which must never leak its internals onto a timeline.
 */
function trouble(
  error: unknown,
  sender: Sender,
  site: Site,
  onError?: (error: unknown) => void,
): string {
  if (error instanceof SelkieApiError) {
    if (error.status === 401) {
      return lines(
        "👋 You will need a wallet first",
        "",
        `1. Open ${site.home}`,
        `2. Sign in as @${sender.username}`,
        "3. Tweet at me again and it goes straight out",
        "",
        "One tap, and nothing to install or write down.",
      );
    }
    if (error.status === 429) {
      return lines("🐢 That is a lot at once", "", "Nothing moved. Give it a minute and try again.");
    }
    return lines(`🚫 ${error.message}`, "", `🔗 ${site.home}`);
  }

  onError?.(error);
  return lines(
    "⚠️ Something went wrong on our side",
    "",
    "Your money did not move. Try again in a moment.",
  );
}

/** Whether a handle names the bot itself. */
function isSelf(handle: string, self?: string): boolean {
  return Boolean(self) && handle.toLowerCase() === self!.replace(/^@/, "").toLowerCase();
}

/**
 * How long it took, in words a person uses.
 *
 * Rounded harder as it gets longer, because "under a second" and "4.2 seconds"
 * are both interesting and "13.4 seconds" is just a number: past ten seconds
 * nobody cares about the decimal and printing it only draws the eye to the wait.
 */
function took(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "no time at all";
  if (ms < 1000) return "under a second";

  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)} seconds` : `${Math.round(seconds)} seconds`;
}

function explain(reason: string, site: Site): string {
  if (reason.startsWith("unknown-asset")) {
    return lines("🤔 I can move USDC and XLM", "", "Try: send 5 USDC to @friend", "", `📖 ${site.docs}`);
  }
  if (reason === "bad-amount") {
    return lines("🤔 That amount did not look right", "", "Try: send 5 to @friend", "", `📖 ${site.docs}`);
  }
  return lines(
    "🤔 I did not quite catch that",
    "",
    "Try: send 5 to @friend",
    "Or:  request 5 from @friend",
    "",
    `📖 ${site.docs}`,
  );
}
