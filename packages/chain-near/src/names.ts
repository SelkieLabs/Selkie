/**
 * X handle -> NEAR account name (design 5.2).
 *
 * @Amaka_ signs in and gets amaka.x.selkiepay.testnet. NEAR account ids allow
 * a-z, 0-9 and the separators - _ . ; no separator at either end and never two
 * in a row; 2 to 64 characters in total (nearcore's near-account-id crate,
 * validation.rs). X usernames are [A-Za-z0-9_], so the only work is lowercasing
 * and tidying underscores.
 *
 * The name is chosen once, at first sign-in, and kept even if the person later
 * renames on X: Selkie's table maps the X user id to the account, not the name.
 */

const LABEL_RE = /^[a-z0-9]+([-_][a-z0-9]+)*$/;
const ACCOUNT_RE = /^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$/;

export function isValidAccountId(id: string): boolean {
  return id.length >= 2 && id.length <= 64 && ACCOUNT_RE.test(id);
}

/** "@Amaka__Obi_" -> "amaka_obi". Null when nothing usable is left. */
export function handleLabel(username: string): string | null {
  const label = username
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return LABEL_RE.test(label) ? label : null;
}

/**
 * The account ids to try, in order: the handle, then the handle plus the last
 * four digits of the X user id, then x<id> (always free, because only the
 * person with that X id can ever get an account under x.).
 */
export function candidateAccountIds(username: string, xUserId: string, parent: string): string[] {
  if (!/^\d+$/.test(xUserId)) throw new Error(`Not an X user id: ${xUserId}`);
  const label = handleLabel(username);
  const ids = label ? [`${label}.${parent}`, `${label}-${xUserId.slice(-4)}.${parent}`] : [];
  ids.push(`x${xUserId}.${parent}`);
  return ids.filter(isValidAccountId);
}
