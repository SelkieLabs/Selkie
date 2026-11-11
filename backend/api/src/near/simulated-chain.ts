/**
 * Test double for NearChain: USDC and the handle escrow, simulated in memory.
 *
 * The NEAR app's tests drive real prepare -> sign -> verify -> relay code
 * against this; only the chain is pretend. It follows the contracts' rules
 * closely enough to catch the mistakes that matter: transfers need a balance
 * and a registered receiver, a receipt's actions land together or not at all,
 * held money waits under a recipient key, and refunds wait for expiry.
 *
 * Never used outside tests.
 */
import type {
  AccessKeySummary,
  Call,
  EscrowEvent,
  NearChain,
  NearServerConfig,
  PaymentView,
  PreparedDelegate,
  TxOutcome,
} from "@selkie/chain-near";

/** Typed off NearChain so the backend never imports a NEAR SDK itself. */
type SignedDelegate = Parameters<NearChain["relay"]>[0];

const USDC = "usdc.test";
const ESCROW = "escrow.test";

export class SimulatedNearChain {
  readonly config = {
    network: "testnet",
    rpcUrl: "http://rpc.test",
    explorerUrl: "https://explorer.test",
    usdcContract: USDC,
    escrowContract: ESCROW,
    handleParent: "x.selkie.test",
    claimLifetimeSecs: 2_592_000,
    relayerAccount: "relayer.selkie.test",
    oracleAccount: "oracle.selkie.test",
    newAccountDeposit: 0n,
  } as unknown as NearServerConfig;

  /** accountId -> public keys on it. Accounts that exist on chain. */
  readonly accounts = new Map<string, string[]>();
  readonly balances = new Map<string, bigint>();
  /** The escrow is registered on USDC at deploy, as on testnet. */
  readonly registered = new Set<string>([ESCROW]);
  readonly payments = new Map<string, PaymentView>();
  /** Every delegate the relayer submitted, for tests that care about its shape. */
  readonly relayed: SignedDelegate[] = [];
  #nextPayment = 1;
  #nonce = 0;
  #tx = 0;

  /** Give an account USDC, as the Circle faucet would. */
  fund(accountId: string, units: bigint): void {
    this.registered.add(accountId);
    this.balances.set(accountId, (this.balances.get(accountId) ?? 0n) + units);
  }

  /** An account that exists but is not Selkie's: an exchange, a friend's wallet. */
  addOutsideAccount(accountId: string): void {
    this.accounts.set(accountId, ["ed25519:outside"]);
  }

  /** Make a held payment refundable now. */
  expire(id: string): void {
    const payment = this.payments.get(id);
    if (payment) payment.expiry_ns = ((BigInt(Date.now()) - 1000n) * 1_000_000n).toString();
  }

  selkieKeys(): string[] {
    return ["ed25519:selkie-creator", "ed25519:selkie-relayer", "ed25519:selkie-oracle"];
  }

  async accountExists(accountId: string): Promise<boolean> {
    return this.accounts.has(accountId);
  }

  async listKeys(accountId: string): Promise<AccessKeySummary[]> {
    return (this.accounts.get(accountId) ?? []).map((publicKey) => ({ publicKey, permission: "full" as const }));
  }

  async usdcBalance(accountId: string): Promise<bigint> {
    return this.balances.get(accountId) ?? 0n;
  }

  async isUsdcRegistered(accountId: string): Promise<boolean> {
    return this.registered.has(accountId);
  }

  async pending(recipient: string): Promise<PaymentView[]> {
    return [...this.payments.values()].filter((payment) => payment.recipient === recipient);
  }

  async getPayment(id: string): Promise<PaymentView | null> {
    const payment = this.payments.get(id);
    return payment ? { ...payment } : null;
  }

  async prepare(senderId: string, publicKey: string, call: Call): Promise<PreparedDelegate> {
    return {
      senderId,
      receiverId: call.receiverId,
      calls: call.calls,
      publicKey,
      nonce: String(++this.#nonce),
      maxBlockHeight: "1000",
    };
  }

  async createHandleAccount(accountId: string, publicKey: string): Promise<string> {
    if (this.accounts.has(accountId)) throw new Error(`${accountId} exists`);
    this.accounts.set(accountId, [publicKey]);
    return this.#hash();
  }

  async registerForUsdc(accountId: string): Promise<string | null> {
    if (this.registered.has(accountId)) return null;
    this.registered.add(accountId);
    return this.#hash();
  }

  async claim(recipient: string, accountId: string): Promise<TxOutcome> {
    const released = await this.pending(recipient);
    let total = 0n;
    for (const payment of released) {
      this.payments.delete(payment.id);
      total += BigInt(payment.amount);
    }
    this.balances.set(accountId, (this.balances.get(accountId) ?? 0n) + total);
    const events: EscrowEvent[] = released.length
      ? [{ event: "claim", data: [{ recipient, account_id: accountId, token: USDC, amount: total.toString(), ids: released.map((p) => p.id) }] }]
      : [];
    return { txHash: this.#hash(), events, failure: null };
  }

  /** Run the signed actions against USDC or the escrow. A failure undoes the whole receipt. */
  async relay(signed: SignedDelegate): Promise<TxOutcome> {
    this.relayed.push(signed);
    const { senderId, receiverId, actions } = signed.delegateAction;
    const snapshot = {
      balances: new Map(this.balances),
      payments: new Map([...this.payments].map(([id, p]) => [id, { ...p }])),
      next: this.#nextPayment,
    };
    const events: EscrowEvent[] = [];
    try {
      for (const action of actions) {
        const call = action.functionCall;
        if (!call) throw new Error("only function calls are simulated");
        const args = JSON.parse(new TextDecoder().decode(call.args)) as Record<string, string>;
        if (receiverId === USDC && call.methodName === "ft_transfer") {
          this.#move(senderId, args.receiver_id!, BigInt(args.amount!));
        } else if (receiverId === USDC && call.methodName === "ft_transfer_call" && args.receiver_id === ESCROW) {
          events.push(...this.#hold(senderId, BigInt(args.amount!), args.msg!));
        } else if (receiverId === ESCROW && call.methodName === "refund") {
          events.push(this.#refund(senderId, String(args.id)));
        } else {
          throw new Error(`not simulated: ${receiverId}.${call.methodName}`);
        }
      }
    } catch (error) {
      this.balances.clear();
      for (const [k, v] of snapshot.balances) this.balances.set(k, v);
      this.payments.clear();
      for (const [k, v] of snapshot.payments) this.payments.set(k, v);
      this.#nextPayment = snapshot.next;
      return { txHash: this.#hash(), events: [], failure: error instanceof Error ? error.message : String(error) };
    }
    return { txHash: this.#hash(), events, failure: null };
  }

  txUrl(hash: string): string {
    return `${this.config.explorerUrl}/transactions/${hash}`;
  }

  accountUrl(accountId: string): string {
    return `${this.config.explorerUrl}/accounts/${accountId}`;
  }

  #move(from: string, to: string, amount: bigint): void {
    if (!this.registered.has(to)) throw new Error(`The account ${to} is not registered`);
    const balance = this.balances.get(from) ?? 0n;
    if (balance < amount) throw new Error("The account doesn't have enough balance");
    this.balances.set(from, balance - amount);
    this.balances.set(to, (this.balances.get(to) ?? 0n) + amount);
  }

  /** The escrow's ft_on_transfer: a bad msg is refunded in full, never half-applied. */
  #hold(sender: string, amount: bigint, rawMsg: string): EscrowEvent[] {
    const msg = JSON.parse(rawMsg) as {
      kind: string;
      recipient?: string;
      lifetime_secs: number;
      items?: { recipient: string; amount: string }[];
    };
    const items =
      msg.kind === "hold" ? [{ recipient: msg.recipient!, amount: amount.toString() }] : msg.kind === "hold_many" ? msg.items! : [];
    const sum = items.reduce((total, item) => total + BigInt(item.amount), 0n);
    if (items.length === 0 || sum !== amount) return [];

    this.#move(sender, ESCROW, amount);
    const expiry = (BigInt(Date.now()) + BigInt(msg.lifetime_secs) * 1000n) * 1_000_000n;
    const created = items.map((item) => {
      const view: PaymentView = {
        id: String(this.#nextPayment++),
        sender,
        token: USDC,
        amount: item.amount,
        recipient: item.recipient,
        expiry_ns: expiry.toString(),
      };
      this.payments.set(view.id, view);
      return { ...view };
    });
    return [{ event: "hold", data: created }];
  }

  #refund(caller: string, id: string): EscrowEvent {
    const payment = this.payments.get(id);
    if (!payment) throw new Error("no such payment");
    if (payment.sender !== caller) throw new Error("only the sender can refund");
    if (BigInt(payment.expiry_ns) > BigInt(Date.now()) * 1_000_000n) throw new Error("not expired yet");
    this.payments.delete(id);
    this.balances.set(ESCROW, (this.balances.get(ESCROW) ?? 0n) - BigInt(payment.amount));
    this.balances.set(caller, (this.balances.get(caller) ?? 0n) + BigInt(payment.amount));
    return { event: "refund", data: [{ id, sender: caller, token: USDC, amount: payment.amount }] };
  }

  #hash(): string {
    return `tx${++this.#tx}`;
  }
}
