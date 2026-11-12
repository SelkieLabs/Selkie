/**
 * Chain and coin logos for NEAR Intents screens.
 *
 * 1Click's token list carries no icons, so these come from Trust Wallet's open
 * logo set (github.com/trustwallet/assets), served by jsDelivr. Linked, not
 * copied: the set is maintained upstream, and each path below was checked to
 * answer with an image on 12 Nov 2026. A logo that fails to load falls back to
 * a letter (ChainLogo), so a CDN outage costs looks, never a screen.
 */
const TRUST_WALLET = "https://cdn.jsdelivr.net/gh/trustwallet/assets@master/blockchains";

/** 1Click's `blockchain` name -> Trust Wallet's folder for it. */
const CHAIN_FOLDERS: Record<string, string> = {
  near: "near",
  eth: "ethereum",
  base: "base",
  arb: "arbitrum",
  sol: "solana",
  tron: "tron",
  bsc: "smartchain",
  pol: "polygon",
  op: "optimism",
  avax: "avalanchec",
  ton: "ton",
};

/** The names people see (same as the server's), back to 1Click's chain name. */
const CHAIN_BY_NAME: Record<string, string> = {
  NEAR: "near",
  Ethereum: "eth",
  Base: "base",
  Arbitrum: "arb",
  Solana: "sol",
  Tron: "tron",
  "BNB Chain": "bsc",
  Polygon: "pol",
  Optimism: "op",
  Avalanche: "avax",
  TON: "ton",
};

const COINS: Record<string, string> = {
  USDC: "/tokens/usdc.svg",
  // Tether's own token on Ethereum: the USDT mark Trust Wallet keeps.
  USDT: `${TRUST_WALLET}/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png`,
};

export function chainLogoUrl(blockchain: string): string | null {
  const folder = CHAIN_FOLDERS[blockchain];
  return folder ? `${TRUST_WALLET}/${folder}/info/logo.png` : null;
}

export function coinLogoUrl(symbol: string): string | null {
  return COINS[symbol.toUpperCase()] ?? null;
}

/**
 * The chain at the end of a feed line such as "0x5aAe…1BeAed on Base", which
 * is how a cash-out to another chain names where it went. Null for anything else.
 */
export function chainInLabel(label: string | null | undefined): string | null {
  const match = label?.match(/ on (.+)$/);
  return match ? (CHAIN_BY_NAME[match[1]!] ?? null) : null;
}
