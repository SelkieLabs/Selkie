import { Networks } from "@stellar/stellar-sdk";
import type { AssetDef } from "./assets";
import { NATIVE_ASSET } from "./assets";

/**
 * Everything the Stellar adapter needs to know about the world it runs in.
 * Nothing here is hardcoded in the adapter: the same code runs against testnet
 * and mainnet by passing a different config, and the escrow contract id comes
 * from contracts/deployments/<network>.env rather than living in source.
 */
export interface StellarConfig {
  /** Horizon, for classic operations, balances, and path finding. */
  horizonUrl: string;
  /** Soroban RPC, for contract calls. */
  rpcUrl: string;
  networkPassphrase: string;
  /** Deployed handle-escrow contract. */
  escrowContractId: string;
  /** Assets Selkie will show and move. See AssetRegistry for why this is a list. */
  assets: AssetDef[];
  /**
   * Account that pays fees and reserves so users never need XLM. This is what
   * makes Selkie gasless from the user's point of view: the network still
   * charges, Selkie just pays it.
   */
  sponsorAddress: string;
  /** How long a payment waits for its handle before the sender can refund it. */
  claimLifetimeSeconds: number;
  /** Default slippage tolerance for swaps, in basis points (100 = 1%). */
  swapSlippageBps: number;
}

const CIRCLE_TESTNET_USDC = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const CIRCLE_PUBLIC_USDC = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const THIRTY_DAYS = 30 * 24 * 60 * 60;

export const TESTNET_USDC: AssetDef = {
  code: "USDC",
  issuer: CIRCLE_TESTNET_USDC,
  label: "US Dollar Coin",
  stable: true,
};

export const PUBLIC_USDC: AssetDef = {
  code: "USDC",
  issuer: CIRCLE_PUBLIC_USDC,
  label: "US Dollar Coin",
  stable: true,
};

export interface NetworkOverrides {
  escrowContractId: string;
  sponsorAddress: string;
  assets?: AssetDef[];
  claimLifetimeSeconds?: number;
  swapSlippageBps?: number;
}

export function testnetConfig(overrides: NetworkOverrides): StellarConfig {
  return {
    horizonUrl: "https://horizon-testnet.stellar.org",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
    assets: [TESTNET_USDC, NATIVE_ASSET],
    claimLifetimeSeconds: THIRTY_DAYS,
    swapSlippageBps: 100,
    ...overrides,
  };
}

export function publicConfig(overrides: NetworkOverrides): StellarConfig {
  return {
    horizonUrl: "https://horizon.stellar.org",
    rpcUrl: "https://mainnet.sorobanrpc.com",
    networkPassphrase: Networks.PUBLIC,
    assets: [PUBLIC_USDC, NATIVE_ASSET],
    claimLifetimeSeconds: THIRTY_DAYS,
    swapSlippageBps: 100,
    ...overrides,
  };
}
