import type { Account, Balance, HandleRef, Money } from "@selkie/core";
import {
  USDC_DECIMALS,
  candidateAccountIds,
  fromBaseUnits,
  publicKeyFromImplicit,
  recipientKeysOf,
  type NearChain,
  type PaymentView,
} from "@selkie/chain-near";
import type { IdentityChain } from "../identity/chain";
import type { User, VerifiedIdentity } from "../identity/types";
import type { BalanceWatch } from "./balance-watch";
import type { NearAccountStore } from "./store";

/** Something the person can fix, said in words they can act on. */
export class NearAccountError extends Error {}

/** How long "nothing is waiting for this key" is believed, to keep reads off every request. */
const EMPTY_TTL_MS = 20_000;

/**
 * The account model's view of NEAR (design 5.1).
 *
 * The difference from Stellar in one sentence: Selkie creates the account but
 * never holds its key. The key is the user's Privy NEAR wallet, read from Privy
 * for the signed-in user, and it is the account's only key.
 */
export class NearIdentityChain implements IdentityChain {
  readonly #emptyUntil = new Map<string, number>();

  constructor(
    private readonly deps: {
      chain: NearChain;
      accounts: NearAccountStore;
      /** Told what each claim released, the moment it lands. */
      watch?: BalanceWatch;
    },
  ) {}

  /**
   * Create `<handle>.x.selkiepay.testnet` with the user's key as its only key.
   *
   * Only an X login opens one: the name comes from the X handle, and proving the
   * login is what keeps the `x.` namespace from being squatted. Idempotent across
   * a half-finished earlier attempt: an account that already exists with exactly
   * this user's key is adopted rather than skipped.
   */
  async openAccount(input: { identities: VerifiedIdentity[]; providerWallet: string | null }): Promise<string> {
    const x = input.identities.find((identity) => identity.provider === "x" && identity.attestation === "login");
    if (!x?.username) throw new NearAccountError("Sign in with X to open your Selkie account.");
    if (!input.providerWallet) {
      throw new NearAccountError("Your wallet is still being set up. Try again in a moment.");
    }
    const publicKey = publicKeyFromImplicit(input.providerWallet);

    const known = await this.deps.accounts.findByXUserId(x.subject);
    if (known) return known.accountId;

    const { chain, accounts } = this.deps;
    for (const candidate of candidateAccountIds(x.username, x.subject, chain.config.handleParent)) {
      if (await accounts.findByAccountId(candidate)) continue;
      if (await chain.accountExists(candidate)) {
        const keys = await chain.listKeys(candidate);
        const ours = keys.length === 1 && keys[0]?.publicKey === publicKey;
        if (!ours) continue;
      } else {
        await chain.createHandleAccount(candidate, publicKey);
      }
      await accounts.insert({ xUserId: x.subject, accountId: candidate, publicKey });
      return candidate;
    }
    throw new NearAccountError("We could not find a free account name for that handle. Contact support.");
  }

  /** Receivable = registered on USDC; the account itself exists from sign-up. */
  async isReceivable(address: string): Promise<boolean> {
    return this.deps.chain.isUsdcRegistered(address);
  }

  async ensureReceivable(address: string): Promise<void> {
    await this.deps.chain.registerForUsdc(address);
  }

  async ensureAccount(): Promise<{ address: string }> {
    throw new NearAccountError("Sign in with X to open your Selkie account.");
  }

  async pendingClaims(handle: HandleRef, owner: User): Promise<string[]> {
    return (await this.#pending(handle, owner)).map((payment) => payment.id);
  }

  async waitingFor(handle: HandleRef, owner: User): Promise<Money[]> {
    const usdc = this.deps.chain.config.usdcContract;
    const total = (await this.#pending(handle, owner))
      .filter((payment) => payment.token === usdc)
      .reduce((sum, payment) => sum + BigInt(payment.amount), 0n);
    return total > 0n ? [{ amount: fromBaseUnits(total, USDC_DECIMALS), asset: "USDC" }] : [];
  }

  /**
   * The oracle releases everything waiting under both of this person's keys
   * (X id and username) into their account. Throws if the escrow reports a
   * failed transfer, so nobody is told money arrived that did not.
   */
  async claim(handle: HandleRef, owner: User): Promise<{ ref?: string }> {
    const { watch } = this.deps;
    // While the oracle's transactions are in flight, the account's balance is
    // ahead of the books on purpose; the watch must not call it outside money.
    return watch ? watch.around([owner.address], () => this.#claim(handle, owner)) : this.#claim(handle, owner);
  }

  async #claim(handle: HandleRef, owner: User): Promise<{ ref?: string }> {
    const usdc = this.deps.chain.config.usdcContract;
    let ref: string | undefined;
    for (const key of await this.#keys(handle, owner)) {
      // The escrow releases at most MAX_CLAIM_BATCH per call (a dust flood must
      // not make a key unclaimable), so keep going until nothing is left. The
      // bound stops a contract bug from becoming an infinite loop of oracle txs.
      for (let round = 0; round < 20 && (await this.deps.chain.pending(key)).length > 0; round++) {
        const outcome = await this.deps.chain.claim(key, owner.address);
        if (outcome.failure || outcome.events.some((event) => event.event === "claim_failed")) {
          throw new Error(`Escrow claim failed in ${outcome.txHash}: ${outcome.failure ?? "claim_failed"}`);
        }
        ref = outcome.txHash;
        for (const event of outcome.events) {
          if (event.event !== "claim") continue;
          for (const data of event.data) {
            if (data.token === usdc) await this.deps.watch?.expect(owner.address, BigInt(String(data.amount)));
          }
        }
      }
      this.#emptyUntil.delete(key);
    }
    return { ref };
  }

  async getBalance(account: Account): Promise<Balance> {
    const units = await this.deps.chain.usdcBalance(account.address);
    return { account, balances: [{ amount: fromBaseUnits(units, USDC_DECIMALS), asset: "USDC" }] };
  }

  /** Selkie cannot move a NEAR user's money: only their own key can. */
  async transfer(): Promise<never> {
    throw new Error("On NEAR the user's own key signs every transfer; Selkie cannot move their money.");
  }

  async #pending(handle: HandleRef, owner: User): Promise<PaymentView[]> {
    const all: PaymentView[] = [];
    for (const key of await this.#keys(handle, owner)) {
      if ((this.#emptyUntil.get(key) ?? 0) > Date.now()) continue;
      const pending = await this.deps.chain.pending(key);
      if (pending.length === 0) this.#emptyUntil.set(key, Date.now() + EMPTY_TTL_MS);
      all.push(...pending);
    }
    return all;
  }

  /** Both keys money could be waiting under for this person's X account. */
  async #keys(handle: HandleRef, owner: User): Promise<string[]> {
    if (handle.platform !== "x") return [];
    const identity = owner.identities.find(
      (linked) => linked.provider === "x" && linked.username?.toLowerCase() === handle.username,
    );
    if (!identity) return [];
    const keys = await recipientKeysOf({ username: handle.username, xUserId: identity.subject });
    return keys.map((entry) => entry.key);
  }
}
