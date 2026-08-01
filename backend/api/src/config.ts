import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Configuration, read once at startup so a missing value fails loudly on boot
 * rather than quietly at the moment someone tries to send money.
 */
export interface ApiConfig {
  port: number;
  network: "testnet" | "public";
  escrowContractId: string;
  privy: { appId: string; appSecret: string };
  /** Pays fees and reserves so users never need XLM. */
  sponsorSecret: string;
  /** Attests logins to the escrow contract. Its only power is releasing a claim. */
  oracleSecret: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const network = (env.SELKIE_NETWORK ?? "testnet") as "testnet" | "public";
  return {
    port: Number(env.PORT ?? 4000),
    network,
    escrowContractId: env.SELKIE_HANDLE_ESCROW_ID ?? escrowFromDeployments(network),
    privy: {
      appId: required(env, "PRIVY_APP_ID"),
      appSecret: required(env, "PRIVY_APP_SECRET"),
    },
    sponsorSecret: required(env, "SELKIE_SPONSOR_SECRET"),
    oracleSecret: required(env, "SELKIE_ORACLE_SECRET"),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Selkie will not start without it, because failing here is better than failing mid-payment.`,
    );
  }
  return value;
}

/** Read the contract id the deploy script recorded, so it lives in one place. */
function escrowFromDeployments(network: string): string {
  const path = resolve(process.cwd(), `contracts/deployments/${network}.env`);
  try {
    const match = readFileSync(path, "utf8").match(/^SELKIE_HANDLE_ESCROW_ID=(\S+)$/m);
    if (match?.[1]) return match[1];
  } catch {
    // Fall through to the error below, which says something useful.
  }
  throw new Error(
    `No escrow contract id. Set SELKIE_HANDLE_ESCROW_ID or deploy first (contracts/scripts/deploy.sh).`,
  );
}
