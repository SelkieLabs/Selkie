/**
 * Who held money waits for (design 5.3).
 *
 * The escrow never sees a username. It holds money for a 32-byte key:
 *
 *  - `x-id`: sha256("x-id:<numeric X user id>"), when we could look the id up.
 *    Survives renames, and a re-registered @handle cannot claim it.
 *  - `username`: sha256("x:<username>"), byte-identical to `handleHash()`, when
 *    no lookup was possible.
 *
 * Whoever signs in with that X account gets both claimed, so either scheme pays.
 */
import { handleHashHex, xIdHashHex } from "@selkie/core";

export type RecipientScheme = "x-id" | "username";

export interface RecipientKey {
  key: string;
  scheme: RecipientScheme;
}

/** The key a new payment should wait under: the id when known, else the username. */
export async function recipientKeyFor(input: { username: string; xUserId?: string | null }): Promise<RecipientKey> {
  if (input.xUserId) return { key: await xIdHashHex(input.xUserId), scheme: "x-id" };
  return { key: await handleHashHex({ platform: "x", username: input.username.toLowerCase() }), scheme: "username" };
}

/** Every key money could be waiting under for someone who just proved this X account. */
export async function recipientKeysOf(owner: { username: string; xUserId: string }): Promise<RecipientKey[]> {
  return [
    { key: await xIdHashHex(owner.xUserId), scheme: "x-id" },
    { key: await handleHashHex({ platform: "x", username: owner.username.toLowerCase() }), scheme: "username" },
  ];
}
