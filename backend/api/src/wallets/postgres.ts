import { KeypairSigner, type Signer, type SignerProvider } from "@selkie/chain-stellar";
import type { Pool } from "pg";
import type { Seal, Sealed } from "../db/seal";

/**
 * Where account keys live, and how they come back out.
 *
 * Two changes from what this replaces, and both of them matter more than the
 * storage engine did.
 *
 * The keys are sealed. The database holds ciphertext; the thing that opens it
 * is in the environment. A dump, a backup, or a restored snapshot is no longer
 * a set of spendable wallets.
 *
 * And they are fetched one at a time. The old version read every key in the
 * system into memory at boot, which works until there are enough users for that
 * to be a slow start and a large, permanent, plaintext target sitting in the
 * heap. Signing already waits on a ledger; a millisecond of Postgres in front
 * of it costs nothing worth counting.
 *
 * Selkie's own accounts, the sponsor and the oracle, are passed in rather than
 * stored. They come from the environment and exist whether or not this table
 * does, and writing them here would only be a second place for them to leak.
 */
export class PostgresSigners implements SignerProvider {
  readonly #pool: Pool;
  readonly #seal: Seal;
  readonly #house = new Map<string, Signer>();

  constructor(pool: Pool, seal: Seal, house: Signer[] = []) {
    this.#pool = pool;
    this.#seal = seal;
    for (const signer of house) this.#house.set(signer.address, signer);
  }

  async forAddress(address: string): Promise<Signer | null> {
    const own = this.#house.get(address);
    if (own) return own;

    const { rows } = await this.#pool.query<{
      ciphertext: Buffer;
      iv: Buffer;
      auth_tag: Buffer;
      key_version: number;
    }>("select ciphertext, iv, auth_tag, key_version from wallet_keys where address = $1", [address]);

    const row = rows[0];
    if (!row) return null;

    const sealed: Sealed = {
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.auth_tag,
      keyVersion: row.key_version,
    };
    return new KeypairSigner(this.#seal.open(sealed, address));
  }

  /**
   * A new account.
   *
   * The key is written down before the address is returned, and the write is
   * awaited rather than fired off. If this process dies in the middle, the cost
   * is an account nobody uses; the other order costs somebody their savings,
   * which is the failure this whole layer exists because of.
   *
   * An arrow function because it is handed to the adapter as `createSigner`,
   * and a method passed by reference would arrive without its `this`.
   */
  create = async (): Promise<Signer> => {
    const { signer, secret } = KeypairSigner.generate();
    const sealed = this.#seal.seal(secret, signer.address);

    await this.#pool.query(
      `insert into wallet_keys (address, ciphertext, iv, auth_tag, key_version)
       values ($1, $2, $3, $4, $5)
       -- Generating an address that already exists means the random number
       -- generator has failed, which is not a thing to paper over by replacing
       -- the key to an account that may hold money.
       on conflict (address) do nothing`,
      [signer.address, sealed.ciphertext, sealed.iv, sealed.authTag, sealed.keyVersion],
    );

    const stored = await this.forAddress(signer.address);
    if (!stored) throw new Error(`Refusing to hand out ${signer.address}: its key was not saved.`);
    return stored;
  };

  /** How many accounts Selkie holds a key for. Printed at boot. */
  async count(): Promise<number> {
    const { rows } = await this.#pool.query<{ count: string }>("select count(*) from wallet_keys");
    return Number(rows[0]?.count ?? 0);
  }
}
