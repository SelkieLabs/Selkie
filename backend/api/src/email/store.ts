/** Someone's email for money-in notices, and where proving it stands. */
export interface EmailRecord {
  userId: string;
  email: string;
  /** ISO time it was proven; null until the code comes back. */
  verifiedAt: string | null;
  /** sha256 of the code; null once used. Never the code itself. */
  codeHash: string | null;
  codeExpiresAt: string | null;
  codeAttempts: number;
  codeSentAt: string | null;
}

export interface EmailStore {
  get(userId: string): Promise<EmailRecord | null>;
  /** A new address, or a new code for the same one: unverified until the code comes back. */
  startVerification(userId: string, email: string, codeHash: string, expiresAt: string, sentAt: string): Promise<void>;
  /** Count a wrong code. Returns the new count. */
  failedAttempt(userId: string): Promise<number>;
  confirm(userId: string, at: string): Promise<void>;
  remove(userId: string): Promise<void>;
}

export class InMemoryEmailStore implements EmailStore {
  readonly #rows = new Map<string, EmailRecord>();

  async get(userId: string) {
    const row = this.#rows.get(userId);
    return row ? { ...row } : null;
  }

  async startVerification(userId: string, email: string, codeHash: string, expiresAt: string, sentAt: string) {
    this.#rows.set(userId, {
      userId,
      email,
      verifiedAt: null,
      codeHash,
      codeExpiresAt: expiresAt,
      codeAttempts: 0,
      codeSentAt: sentAt,
    });
  }

  async failedAttempt(userId: string) {
    const row = this.#rows.get(userId);
    if (!row) return 0;
    row.codeAttempts += 1;
    return row.codeAttempts;
  }

  async confirm(userId: string, at: string) {
    const row = this.#rows.get(userId);
    if (row) Object.assign(row, { verifiedAt: at, codeHash: null, codeExpiresAt: null, codeAttempts: 0 });
  }

  async remove(userId: string) {
    this.#rows.delete(userId);
  }
}
