/**
 * Turning a message into an instruction.
 *
 * Pure, with no I/O, because this is the part that decides what happens to
 * somebody's money and it should be possible to prove it right by reading it.
 * Shared by every surface: what X and Telegram disagree about is how a message
 * arrives and how a reply is posted, never what "send 5 to @amaka" means.
 *
 * Two rules run through all of it.
 *
 * Unrecognised text returns null and gets no reply. Most mentions of a payments
 * bot are people talking about it, not to it, and answering them would be noise
 * on the timeline and a bill for every post.
 *
 * Anything doubtful is refused rather than guessed. There is no clarifying
 * question to ask on a public timeline, so a number we are not certain of is a
 * number we do not send.
 */

/** What Selkie will move. Matches the chain adapter's allowlist. */
export const ASSETS = ["USDC", "XLM"] as const;
export type Asset = (typeof ASSETS)[number];

/** When nobody says, they mean dollars. */
export const DEFAULT_ASSET: Asset = "USDC";

export type Command =
  | { type: "send"; amount: string; asset: Asset; to: string; note?: string }
  | { type: "request"; amount: string; asset: Asset; from: string }
  | { type: "balance" }
  | { type: "history" }
  | { type: "help" }
  | { type: "error"; reason: string };

/**
 * Amount grammar, deliberately narrow.
 *
 * Up to seven decimals because that is the finest amount Stellar records, and no
 * exponent form: "1e9" is never what a person typing into a tweet meant, and
 * reading it as a billion would be an expensive way to find that out.
 */
const AMOUNT = String.raw`\d{1,12}(?:\.\d{1,7})?`;

/**
 * X handles are 1 to 15 characters, letters, digits and underscore. Telegram
 * allows 5 to 32 of the same, so this covers both and the platform rejects the
 * rest. Bounded on purpose: an unbounded \w+ next to a quantifier is how a
 * parser becomes somewhere to send a very long string.
 */
const HANDLE = String.raw`@([A-Za-z0-9_]{1,32})`;

/** Optional asset word. Missing means dollars. */
const ASSET = String.raw`(?:\s*([A-Za-z]{2,8}))?`;

/** A leading currency symbol reads as dollars, so "$5" needs no asset word. */
const DOLLARS = String.raw`\$?`;

const SEND_PATTERNS = [
  // send 5 usdc to @amaka [note]
  new RegExp(String.raw`\b(?:send|pay|transfer)\s+${DOLLARS}(${AMOUNT})${ASSET}\s+to\s+${HANDLE}(?:\s+(.*))?$`, "i"),
  // send @amaka 5 usdc [note] / pay @amaka $5
  new RegExp(String.raw`\b(?:send|pay|transfer)\s+${HANDLE}\s+${DOLLARS}(${AMOUNT})${ASSET}(?:\s+(.*))?$`, "i"),
];

const REQUEST_PATTERNS = [
  new RegExp(String.raw`\brequest\s+${DOLLARS}(${AMOUNT})${ASSET}\s+from\s+${HANDLE}`, "i"),
  new RegExp(String.raw`\brequest\s+${HANDLE}\s+(?:for\s+)?${DOLLARS}(${AMOUNT})${ASSET}`, "i"),
];

export interface ParseOptions {
  /** The bot's own handle, stripped before parsing so it is not read as a payee. */
  self?: string;
}

export function parseCommand(text: string, options: ParseOptions = {}): Command | null {
  const cleaned = strip(text, options.self);

  for (const pattern of SEND_PATTERNS) {
    const match = cleaned.match(pattern);
    if (!match) continue;
    // The two orderings put the handle in different groups.
    const handleFirst = pattern === SEND_PATTERNS[1];
    const to = handleFirst ? match[1] : match[3];
    const amount = handleFirst ? match[2] : match[1];
    const asset = handleFirst ? match[3] : match[2];
    return build("send", { amount, asset, handle: to, note: match[4] });
  }

  for (const pattern of REQUEST_PATTERNS) {
    const match = cleaned.match(pattern);
    if (!match) continue;
    const handleFirst = pattern === REQUEST_PATTERNS[1];
    const from = handleFirst ? match[1] : match[3];
    const amount = handleFirst ? match[2] : match[1];
    const asset = handleFirst ? match[3] : match[2];
    return build("request", { amount, asset, handle: from });
  }

  // Checked after the money rules, so "send 5 to @amaka for balance" is a
  // payment and not a balance lookup.
  if (/\bbalance\b/i.test(cleaned)) return { type: "balance" };
  if (/\b(?:history|activity|transactions)\b/i.test(cleaned)) return { type: "history" };
  if (/\b(?:help|commands|how do i|what can you do)\b/i.test(cleaned)) return { type: "help" };

  /**
   * An instruction we recognise the shape of but cannot read.
   *
   * "send 5 dollars @amaka" is plainly meant for us and plainly not something we
   * should guess at, so it earns one reply showing the format. The test is that
   * the message OPENS with the verb: somebody writing "I used Selkie to send
   * money to @amaka yesterday" is talking about us, not to us, and answering
   * them would be noise on the timeline and a bill for every post.
   */
  if (/^(?:send|pay|transfer|request)\b/i.test(cleaned) && /@[A-Za-z0-9_]/.test(cleaned)) {
    return { type: "error", reason: "unparsed" };
  }

  return null;
}

function build(
  type: "send" | "request",
  parts: { amount?: string; asset?: string; handle?: string; note?: string },
): Command {
  const asset = normalizeAsset(parts.asset);
  if (!asset) return { type: "error", reason: `unknown-asset:${parts.asset}` };

  const amount = normalizeAmount(parts.amount);
  if (!amount) return { type: "error", reason: "bad-amount" };

  const handle = parts.handle?.toLowerCase();
  if (!handle) return { type: "error", reason: "no-handle" };

  if (type === "request") return { type, amount, asset, from: handle };

  const note = parts.note?.trim().slice(0, 60) || undefined;
  return { type, amount, asset, to: handle, note };
}

/** An unrecognised asset word is refused, never quietly treated as dollars. */
function normalizeAsset(word: string | undefined): Asset | null {
  if (!word) return DEFAULT_ASSET;
  const upper = word.toUpperCase();
  if (upper === "DOLLARS" || upper === "USD") return "USDC";
  return (ASSETS as readonly string[]).includes(upper) ? (upper as Asset) : null;
}

/**
 * Normalize, and refuse anything that is not a plain positive number.
 *
 * The regex has already limited the shape; this catches what shape cannot: zero,
 * and the all-zeroes forms that pass a digit check and move nothing.
 */
function normalizeAmount(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return raw.replace(/^0+(?=\d)/, "");
}

/**
 * Remove the bot's own handle and normalize whitespace.
 *
 * X puts "@SelkiePay" at the front of a reply, and without this "@SelkiePay send
 * 5" would read as a payment to the bot. Every mention of it goes, not just the
 * first, because a thread can carry several.
 */
function strip(text: string, self?: string): string {
  let cleaned = String(text ?? "");
  if (self) {
    const escaped = self.replace(/^@/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(`@${escaped}\\b`, "gi"), " ");
  }
  // Collapse whitespace so a line break between words does not defeat a rule.
  return cleaned.replace(/\s+/g, " ").trim();
}
