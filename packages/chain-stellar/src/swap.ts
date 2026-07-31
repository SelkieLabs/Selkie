import { Operation } from "@stellar/stellar-sdk";
import type { Account, Money, SwapProvider, SwapQuote } from "@selkie/core";
import { applySlippage, fromStroops, toStellarAmount, toStroops } from "./amounts";
import type { AssetRegistry } from "./assets";
import type { StellarNetwork } from "./network";
import type { Signer, SignerProvider } from "./signer";

/**
 * Swapping one Stellar asset for another.
 *
 * Stellar has an order book and liquidity pools built into the protocol, so a
 * swap is a path payment to yourself: send asset A, receive asset B, and let the
 * network find the best route. No DEX contract, no router deployment, no extra
 * trust. This is why swap is in the MVP and not a later integration.
 *
 * The user-facing word for this is "Convert". "Swap" and "exchange" mean
 * different things to different people, and money apps should not make people
 * guess.
 */
export class StellarSwapProvider implements SwapProvider {
  readonly id = "stellar-dex";

  constructor(
    private readonly network: StellarNetwork,
    private readonly assets: AssetRegistry,
    private readonly signers: SignerProvider,
    private readonly options: { sponsor: Signer; slippageBps: number },
  ) {}

  /**
   * What you would receive, quoted by the network itself. Returns the best route
   * currently available; a route can move between quoting and executing, which
   * is what the slippage floor protects against.
   */
  async quote(from: Money, toAsset: string): Promise<SwapQuote> {
    const sendAsset = this.assets.toStellarAsset(from.asset);
    const receiveAsset = this.assets.toStellarAsset(toAsset);
    const sendAmount = toStellarAmount(from.amount);

    const paths = await this.network.horizon
      .strictSendPaths(sendAsset, sendAmount, [receiveAsset])
      .call();

    const best = paths.records[0];
    if (!best) {
      throw new NoSwapRouteError(
        `There is no route to convert ${from.asset} into ${toAsset} right now.`,
      );
    }

    return {
      provider: this.id,
      from,
      to: { amount: best.destination_amount, asset: toAsset },
    };
  }

  /**
   * Execute the conversion. The account swaps with itself: same account on both
   * sides, different asset out. Fees are sponsored, so a user converting dollars
   * never needs XLM to do it.
   */
  async swap(account: Account, from: Money, toAsset: string): Promise<{ ref: string }> {
    const signer = await this.signers.forAddress(account.address);
    if (!signer) {
      throw new NoSwapRouteError(`Selkie cannot sign for ${account.address}.`);
    }

    const quote = await this.quote(from, toAsset);
    const minimumReceived = applySlippage(toStroops(quote.to.amount), this.options.slippageBps);

    const response = await this.network.submit({
      source: account.address,
      operations: [
        Operation.pathPaymentStrictSend({
          sendAsset: this.assets.toStellarAsset(from.asset),
          sendAmount: toStellarAmount(from.amount),
          destination: account.address,
          destAsset: this.assets.toStellarAsset(toAsset),
          destMin: fromStroops(minimumReceived),
          path: [],
        }),
      ],
      signers: [signer],
      sponsor: this.options.sponsor,
    });

    return { ref: response.hash };
  }
}

export class NoSwapRouteError extends Error {}
