import { Keypair } from "@stellar/stellar-sdk";
import type { Transaction, FeeBumpTransaction } from "@stellar/stellar-sdk";

/**
 * How a transaction gets signed, without the adapter caring where the key is.
 *
 * Today the backend holds keys for accounts it provisions. Tomorrow that should
 * be Privy embedded wallets or device passkeys, where Selkie never sees a key at
 * all. That upgrade is meant to be a new Signer implementation and nothing else,
 * which is why every signing path in this package goes through this interface.
 */
export interface Signer {
  readonly address: string;
  sign(tx: Transaction | FeeBumpTransaction): Promise<void>;
}

/** Resolves the signer for an account address, or null if we cannot sign for it. */
export interface SignerProvider {
  forAddress(address: string): Promise<Signer | null>;
}

/**
 * Signs with a raw secret key held in memory.
 *
 * For development, tests, and the sponsor account. User funds should move to a
 * custody solution before real money is involved; keeping that behind Signer is
 * what makes the swap cheap.
 */
export class KeypairSigner implements Signer {
  readonly #keypair: Keypair;

  constructor(secret: string) {
    this.#keypair = Keypair.fromSecret(secret);
  }

  static generate(): { signer: KeypairSigner; secret: string } {
    const keypair = Keypair.random();
    const secret = keypair.secret();
    return { signer: new KeypairSigner(secret), secret };
  }

  get address(): string {
    return this.#keypair.publicKey();
  }

  async sign(tx: Transaction | FeeBumpTransaction): Promise<void> {
    tx.sign(this.#keypair);
  }
}

/** A SignerProvider backed by a map of address to signer. */
export class InMemorySignerProvider implements SignerProvider {
  readonly #signers = new Map<string, Signer>();

  constructor(signers: Signer[] = []) {
    for (const signer of signers) this.add(signer);
  }

  add(signer: Signer): void {
    this.#signers.set(signer.address, signer);
  }

  async forAddress(address: string): Promise<Signer | null> {
    return this.#signers.get(address) ?? null;
  }
}
