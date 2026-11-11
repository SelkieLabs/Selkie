/**
 * Network configuration. Testnet and mainnet differ only by these values, so
 * nothing below this file knows which one it is talking to.
 *
 * Split in two on purpose: `NearPublicConfig` is safe to hand to a browser,
 * `NearServerConfig` adds the keys the backend signs with. A type that mixed the
 * two would be one careless spread away from shipping a key to the client.
 */
import type { KeyPairString } from "near-api-js";

export type NearNetwork = "testnet" | "mainnet";

export interface NearPublicConfig {
  network: NearNetwork;
  rpcUrl: string;
  explorerUrl: string;
  /** The NEP-141 USDC contract. Testnet: Circle's; mainnet: read it from 1Click. */
  usdcContract: string;
  escrowContract: string;
  /** `x.selkiepay.testnet`: every handle account is created under it. */
  handleParent: string;
  /** How long held money waits before its sender may take it back. */
  claimLifetimeSecs: number;
}

export interface NearServerConfig extends NearPublicConfig {
  /** Full-access key of `handleParent`. Only ever used for CreateAccount. */
  handleParentKey: KeyPairString;
  relayerAccount: string;
  /** Pays gas for actions users signed; cannot change what they signed. */
  relayerKey: KeyPairString;
  oracleAccount: string;
  /** A function-call key that can call `escrow.claim` and nothing else. */
  oracleKey: KeyPairString;
  /** yoctoNEAR given to each new handle account so it can pay for its own storage. */
  newAccountDeposit: bigint;
}

/** Explorer per network. Testnet verified live on 11 Nov; mainnet must be set explicitly. */
const EXPLORERS: Partial<Record<NearNetwork, string>> = {
  testnet: "https://explorer.testnet.near.org",
};

type Env = Record<string, string | undefined>;

export function nearConfigFromEnv(env: Env = process.env): NearServerConfig {
  const network = (env.NEAR_NETWORK ?? "testnet") as NearNetwork;
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error(`NEAR_NETWORK must be testnet or mainnet, not ${network}`);
  }
  const explorerUrl = env.NEAR_EXPLORER_URL ?? EXPLORERS[network];
  if (!explorerUrl) throw new Error("NEAR_EXPLORER_URL is required on mainnet");

  return {
    network,
    rpcUrl: required(env, "NEAR_RPC_URL"),
    explorerUrl: explorerUrl.replace(/\/$/, ""),
    usdcContract: required(env, "NEAR_USDC_CONTRACT"),
    escrowContract: required(env, "NEAR_ESCROW_CONTRACT"),
    handleParent: required(env, "NEAR_HANDLE_PARENT"),
    claimLifetimeSecs: positiveInt(env.SELKIE_CLAIM_LIFETIME_SECS ?? "2592000", "SELKIE_CLAIM_LIFETIME_SECS"),
    handleParentKey: key(env, "NEAR_HANDLE_PARENT_KEY"),
    relayerAccount: required(env, "NEAR_RELAYER_ACCOUNT"),
    relayerKey: key(env, "NEAR_RELAYER_KEY"),
    oracleAccount: required(env, "NEAR_ORACLE_ACCOUNT"),
    oracleKey: key(env, "NEAR_ORACLE_KEY"),
    // 0.01 NEAR: the USDC storage deposit (0.00125) is paid by the relayer, so
    // this only has to cover the account's own state, with room to spare.
    newAccountDeposit: BigInt(env.NEAR_NEW_ACCOUNT_DEPOSIT ?? "10000000000000000000000"),
  };
}

/** The browser-safe half of a server config. */
export function publicConfig(config: NearPublicConfig): NearPublicConfig {
  const { network, rpcUrl, explorerUrl, usdcContract, escrowContract, handleParent, claimLifetimeSecs } = config;
  return { network, rpcUrl, explorerUrl, usdcContract, escrowContract, handleParent, claimLifetimeSecs };
}

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function key(env: Env, name: string): KeyPairString {
  const value = required(env, name);
  // Checked for shape only, and the message never echoes the value: this is a
  // secret, and error messages end up in logs.
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(value)) throw new Error(`${name} is not an ed25519 key`);
  return value as KeyPairString;
}

function positiveInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
