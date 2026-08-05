/**
 * Counting and trimming a reply the way X does.
 *
 * A tweet is not 280 characters. It is 280 *weighted* characters, and every
 * emoji counts as two. A reply built out of emoji lines that measures 274 by
 * `String.length` can be 300 to X, which comes back as a 403 and a person who
 * never got an answer. So the length used to decide anything here is X's, not
 * JavaScript's.
 */

/** X's limit, in weighted characters. */
export const MAX_WEIGHT = 280;

/**
 * A link is charged as 23 whatever its length, because X rewrites every URL to
 * a t.co one of that size. Counting the raw characters instead would make a long
 * link look unaffordable and cut a reply that would have fitted.
 */
const LINK_WEIGHT = 23;

/**
 * Enough of a URL to price one.
 *
 * Every label of the host is taken, not just the last two, or
 * `selkiepay.vercel.app` would be read as the text "selkiepay." followed by the
 * link "vercel.app" and charged for both.
 *
 * The known-suffix list is short on purpose, and being short is safe: a link
 * this misses is charged its raw length, which is more than 23, so a miss makes
 * the reply shorter than it needed to be and never longer than X allows.
 */
const LINK =
  /https?:\/\/\S+|\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|app|dev|io|org|net|xyz|co|me|ai)\b(?:\/\S*)?/gi;

/**
 * X's own weighting table: most of Latin, punctuation and the general
 * punctuation block count as one, and everything else, emoji included, counts
 * as two.
 */
function weighCodePoint(code: number): number {
  const single =
    (code >= 0 && code <= 4351) ||
    (code >= 8192 && code <= 8205) ||
    (code >= 8208 && code <= 8223) ||
    (code >= 8242 && code <= 8247);
  return single ? 1 : 2;
}

/** What X will say this text measures. */
export function weigh(text: string): number {
  let total = 0;
  let index = 0;

  // Links are charged flat, so they are measured whole and skipped over rather
  // than counted character by character.
  for (const match of text.matchAll(LINK)) {
    total += weighRun(text.slice(index, match.index)) + LINK_WEIGHT;
    index = match.index + match[0].length;
  }
  return total + weighRun(text.slice(index));
}

function weighRun(run: string): number {
  let total = 0;
  for (const character of run) total += weighCodePoint(character.codePointAt(0) ?? 0);
  return total;
}

/**
 * Trim to fit, on a word and never mid-link.
 *
 * A reply cut through a number or an address would be worse than one cut short,
 * so the ellipsis lands at a space and the whole last word goes with it.
 */
export function cap(text: string, limit = MAX_WEIGHT): string {
  const trimmed = text.trimEnd();
  if (weigh(trimmed) <= limit) return trimmed;

  // Walk back a word at a time. Slow in principle, irrelevant in practice: a
  // reply is a few dozen words and this runs once per answer.
  const words = trimmed.split(/(\s+)/);
  let out = "";
  for (const word of words) {
    if (weigh(out + word + "…") > limit) break;
    out += word;
  }
  return `${out.trimEnd()}…`;
}

/**
 * Join the parts of a reply, dropping the empty ones.
 *
 * Blocks are composed conditionally, and a missing one must close its own gap
 * rather than leave a double blank line in the middle of a tweet.
 */
export function lines(...parts: (string | false | null | undefined)[]): string {
  // Tested against the part rather than its truthiness, because "" is a
  // deliberate blank line and dropping it would run two blocks together.
  return parts
    .filter((part): part is string => part !== false && part !== null && part !== undefined)
    .join("\n");
}
