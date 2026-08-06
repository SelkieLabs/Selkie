import { InMemorySignerProvider, KeypairSigner, type Signer } from "@selkie/chain-stellar";
import type { Keep } from "@selkie/core";

const SHELF = "wallets";

/**
 * The keys to every account Selkie made for somebody.
 *
 * These used to be generated with `Keypair.random()` and held in a Map and
 * nowhere else, which meant a restart was not a restart. It was a deletion. The
 * money stayed exactly where it was, on a public ledger, in an account whose
 * only key had just been thrown away, and nothing anywhere reported a problem.
 *
 * So the key is written down before anybody is told the address, and never the
 * other way round. If the process dies between those two lines the worst that
 * happens is an unused account; if they were reversed, the worst that happens
 * is somebody's money in a place no one can reach.
 *
 * These are raw secrets in a file, which is honest about what it is: fine for
 * testnet, not fine for real money. The reason this class exists at all is that
 * replacing it with Privy should mean changing what `create` returns and
 * nothing else, because everything above it only knows about `Signer`.
 */
export class Wallets {
  readonly signers: InMemorySignerProvider;
  readonly #keep: Keep;
  readonly #secrets: string[];

  /**
   * `house` is the sponsor and oracle: Selkie's own accounts, which come from
   * the environment and are deliberately not written here. They exist whether
   * or not this file does.
   */
  constructor(keep: Keep, house: Signer[] = []) {
    this.#keep = keep;
    this.#secrets = keep.read<string[]>(SHELF) ?? [];
    this.signers = new InMemorySignerProvider([
      ...house,
      ...this.#secrets.map((secret) => new KeypairSigner(secret)),
    ]);
  }

  /** How many accounts came back with us. Printed at boot, so a restart that quietly lost them is visible. */
  get count(): number {
    return this.#secrets.length;
  }

  /**
   * A new account.
   *
   * An arrow function because it is handed to the adapter as `createSigner`,
   * and a method passed by reference would arrive without its `this`.
   */
  create = async (): Promise<Signer> => {
    const { signer, secret } = KeypairSigner.generate();
    this.#secrets.push(secret);
    this.#keep.write(SHELF, this.#secrets);
    this.signers.add(signer);
    return signer;
  };
}
