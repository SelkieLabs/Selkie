import { Asset, Operation } from "@stellar/stellar-sdk";
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
    const { received } = await this.#bestRoute(from, toAsset);
    return { provider: this.id, from, to: { amount: received, asset: toAsset } };
  }

  /**
   * The route behind a quote, not just its price.
   *
   * Stellar can reach an asset through intermediate ones, and the best price is
   * often a hop or two away. Quoting the routed price and then executing without
   * the route is quoting one trade and making another: the direct market is
   * worse, or missing entirely, so the payment either fills below the number the
   * user was shown or fails against its own slippage floor.
   */
  async #bestRoute(from: Money, toAsset: string): Promise<{ received: string; path: Asset[] }> {
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

    return { received: best.destination_amount, path: (best.path ?? []).map(toAsset_) };
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

    const { received, path } = await this.#bestRoute(from, toAsset);
    const minimumReceived = applySlippage(toStroops(received), this.options.slippageBps);

    const response = await this.network.submit({
      source: account.address,
      operations: [
        Operation.pathPaymentStrictSend({
          sendAsset: this.assets.toStellarAsset(from.asset),
          sendAmount: toStellarAmount(from.amount),
          destination: account.address,
          destAsset: this.assets.toStellarAsset(toAsset),
          destMin: fromStroops(minimumReceived),
          // The route the price came from. Anything else is a different trade.
          path,
        }),
      ],
      signers: [signer],
      sponsor: this.options.sponsor,
    });

    return { ref: response.hash };
  }
}

export class NoSwapRouteError extends Error {}

/**
 * Horizon describes a hop as loose JSON. The SDK wants an Asset, and the two
 * disagree about what to call the native one.
 */
function toAsset_(hop: {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}): Asset {
  if (hop.asset_type === "native") return Asset.native();
  return new Asset(hop.asset_code!, hop.asset_issuer!);
}
