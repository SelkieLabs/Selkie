import type { Command } from "./parse";
import { SelkieApiError } from "./selkie";
import type { SelkieClient, Sender } from "./selkie";

/**
 * What a message turns into.
 *
 * Surface-agnostic on purpose: X and Telegram differ in how a message arrives
 * and how a reply is posted, never in what it means. Everything here is a plain
 * string, so adding Telegram is a new transport and nothing else.
 *
 * Two rules shape every line below.
 *
 * Nothing private is ever said in public. A balance and a history belong in the
 * app, not on a timeline where the whole internet reads them, so the reply is a
 * pointer rather than an answer. This is not squeamishness: a public balance is
 * a public invitation to whoever wants to take it.
 *
 * Nothing here talks like a crypto app. Nobody is told about trustlines, gas,
 * escrow, or a ledger. They are told their money was sent and that their friend
 * can pick it up, because that is what happened.
 */

/** Replies must fit a tweet. */
const MAX_LENGTH = 280;

export interface RespondOptions {
  /** Where people are sent to open their wallet. */
  webUrl: string;
  /** Called with anything unexpected. Never shown to the person. */
  onError?: (error: unknown) => void;
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

  const app = options.webUrl.replace(/^https?:\/\//, "");

  switch (command.type) {
    case "balance":
    case "history":
      return cap(`That one stays private. Open your wallet at ${app} to see it.`);

    case "help":
      return cap(
        `Reply with "send 5 to @friend" and I will move it. They do not need an account, it waits for them. Your wallet lives at ${app}`,
      );

    case "error":
      return cap(explain(command.reason, app));

    case "send":
      return cap(await sendMoney(command, sender, selkie, app, options.onError));

    case "request":
      return cap(await askFor(command, sender, selkie, app, options.onError));
  }
}

async function sendMoney(
  command: Extract<Command, { type: "send" }>,
  sender: Sender,
  selkie: SelkieClient,
  app: string,
  onError?: (error: unknown) => void,
): Promise<string> {
  if (command.to === sender.username) {
    return "That is you. Pick someone else and I will send it.";
  }

  try {
    const result = await selkie.send(sender, {
      to: command.to,
      amount: command.amount,
      asset: command.asset,
      note: command.note,
      platform: sender.platform,
    });

    const money = `${command.amount} ${command.asset}`;
    return result.waitingToBeClaimed
      ? `Sent ${money} to @${command.to}. It is waiting for them to open ${app} and pick it up.`
      : `Sent ${money} to @${command.to}. ✅`;
  } catch (error) {
    return trouble(error, sender, app, onError);
  }
}

async function askFor(
  command: Extract<Command, { type: "request" }>,
  sender: Sender,
  selkie: SelkieClient,
  app: string,
  onError?: (error: unknown) => void,
): Promise<string> {
  if (command.from === sender.username) {
    return "That is you. Name someone else and I will pass it on.";
  }

  try {
    await selkie.request(sender, {
      from: command.from,
      amount: command.amount,
      asset: command.asset,
      platform: sender.platform,
    });
    return `Asked @${command.from} for ${command.amount} ${command.asset}. They will see it at ${app}`;
  } catch (error) {
    return trouble(error, sender, app, onError);
  }
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
  app: string,
  onError?: (error: unknown) => void,
): string {
  if (error instanceof SelkieApiError) {
    if (error.status === 401) {
      return `You will need a wallet first. Open ${app}, sign in as @${sender.username}, and I can send it for you.`;
    }
    if (error.status === 429) {
      return "That is a lot at once. Give it a minute and try again.";
    }
    return error.message;
  }

  onError?.(error);
  return "Something went wrong on our side. Nothing moved. Try again in a moment.";
}

function explain(reason: string, app: string): string {
  if (reason.startsWith("unknown-asset")) {
    return "I can send USDC or XLM. Try: send 5 USDC to @friend";
  }
  if (reason === "bad-amount") {
    return "That amount did not look right. Try: send 5 to @friend";
  }
  return `I did not quite catch that. Try: send 5 to @friend, or open ${app}`;
}

/**
 * Trim to fit, on a word where possible.
 *
 * A reply cut mid-number would be worse than one cut short, so the ellipsis
 * always lands somewhere a person can see the sentence was truncated.
 */
function cap(text: string): string {
  if (text.length <= MAX_LENGTH) return text;
  const cut = text.slice(0, MAX_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > MAX_LENGTH - 40 ? cut.slice(0, lastSpace) : cut}…`;
}
