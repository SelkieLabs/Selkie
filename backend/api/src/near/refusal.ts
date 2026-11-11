/**
 * A request we will not carry out, with the status and the words to say why.
 * `extra` rides along in the response body (a transaction link, say), so a
 * failure that did reach the chain can still be looked up.
 */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
