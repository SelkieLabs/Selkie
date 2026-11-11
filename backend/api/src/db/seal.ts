import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Sealing account keys, so a copy of the database is not a pile of spendable
 * wallets.
 *
 * Moving secrets from a file into Postgres is not on its own an improvement: it
 * is the same secret, in a place with more copies of it. Backups, replicas,
 * a restored snapshot on somebody's laptop, a support query pasted into a chat.
 * Every one of those is a full set of keys if the column is plaintext.
 *
 * So the database holds ciphertext and the key that opens it lives in the
 * environment, which means losing one does not lose the other. That is the
 * whole property. It does not defend against a compromised running server,
 * which has to be able to sign; for that the answer is not encryption but
 * custody somewhere Selkie never sees a key at all, which is what the Signer
 * interface exists to make swappable.
 *
 * AES-256-GCM: it authenticates as well as encrypts, so a tampered row fails
 * loudly instead of decrypting to something else.
 */
export interface Sealed {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

/** Twelve bytes, which is what GCM is specified around. */
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class SealError extends Error {}

export class Seal {
  readonly #keys: Map<number, Buffer>;
  readonly #current: number;

  /**
   * Keys newest first. The first is used to seal; every one of them can open,
   * which is what makes rotation possible without a day where nothing works.
   */
  constructor(keys: { version: number; key: Buffer }[]) {
    if (keys.length === 0) throw new SealError("No wallet encryption key.");
    this.#keys = new Map();
    for (const { version, key } of keys) {
      if (key.length !== KEY_BYTES) {
        throw new SealError(`Wallet key v${version} is ${key.length} bytes; it must be ${KEY_BYTES}.`);
      }
      if (this.#keys.has(version)) throw new SealError(`Two wallet keys both call themselves v${version}.`);
      this.#keys.set(version, key);
    }
    this.#current = keys[0]!.version;
  }

  /**
   * Read keys from the environment.
   *
   * Format is `version:base64`, newest first, comma separated. Rotating means
   * putting a new one on the front and leaving the old one there until
   * everything sealed under it has been re-sealed.
   */
  static fromEnv(value: string | undefined, name = "SELKIE_WALLET_KEY"): Seal {
    if (!value) {
      throw new SealError(
        `${name} is not set, and Selkie will not start without it. It is what stops a copy of the ` +
          `database from being a copy of everybody's wallet. Generate one with: ` +
          `node -e "console.log('1:' + require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }

    const keys = value.split(",").map((entry) => {
      const [version, encoded] = entry.trim().split(":");
      const parsed = Number(version);
      if (!Number.isInteger(parsed) || parsed < 1 || !encoded) {
        throw new SealError(`${name} entries look like "1:<base64>". Got "${entry.trim()}".`);
      }
      return { version: parsed, key: Buffer.from(encoded, "base64") };
    });

    return new Seal(keys);
  }

  /**
   * Seal a secret to one address.
   *
   * The address is authenticated alongside the ciphertext but not encrypted, so
   * a row cannot be lifted and dropped onto a different address: opening it
   * against the wrong one fails rather than handing back a key for an account
   * it does not belong to.
   */
  seal(plaintext: string, address: string): Sealed {
    const key = this.#keys.get(this.#current)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(address, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: this.#current };
  }

  open(sealed: Sealed, address: string): string {
    const key = this.#keys.get(sealed.keyVersion);
    if (!key) {
      throw new SealError(
        `This account was sealed with wallet key v${sealed.keyVersion}, which is not configured. ` +
          `Removing an old key before re-sealing what it protects makes those accounts unspendable.`,
      );
    }

    const decipher = createDecipheriv("aes-256-gcm", key, sealed.iv);
    decipher.setAAD(Buffer.from(address, "utf8"));
    decipher.setAuthTag(sealed.authTag);
    try {
      return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8");
    } catch {
      // GCM failing is not a corrupt byte to be worked around. It means the
      // ciphertext, the address it claims to belong to, or the key is not what
      // it was when this was written, and none of those may be guessed past.
      throw new SealError(`The stored key for ${address} does not check out, so it was not used.`);
    }
  }

  /** Whether a sealed row is already under the newest key, for a rotation pass. */
  isCurrent(sealed: Sealed): boolean {
    return sealed.keyVersion === this.#current;
  }
}

/** Constant-time compare, for anywhere a secret is checked rather than opened. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
