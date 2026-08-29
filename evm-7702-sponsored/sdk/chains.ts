export type StableTokenSymbol = "USDT" | "USDC";

export type SupportedChainKey = "ethereum" | "bsc" | "arbitrumOne" | "polygon";

export type SupportedChainToken = {
  chainId: number;
  chainKey: SupportedChainKey;
  tokenSymbol: StableTokenSymbol;
  tokenAddress: `0x${string}`;
  decimals: number;
  enabled: boolean;
  verified: boolean;
  needsCanary?: boolean;
  note: string;
};

// enabled=true only means the SDK can build payloads for the token.
// verified=false or needsCanary=true still requires registry allowlisting,
// provider endpoint setup, a real small-value canary, and reconciliation before
// production broadcast.
export const SUPPORTED_CHAIN_TOKENS = [
  {
    chainKey: "ethereum",
    chainId: 1,
    tokenSymbol: "USDT",
    tokenAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    decimals: 6,
    enabled: true,
    verified: true,
    note: "Ethereum mainnet canonical USDT.",
  },
  {
    chainKey: "ethereum",
    chainId: 1,
    tokenSymbol: "USDC",
    tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
    enabled: true,
    verified: true,
    note: "Ethereum mainnet canonical USDC.",
  },
  {
    chainKey: "bsc",
    chainId: 56,
    tokenSymbol: "USDT",
    tokenAddress: "0x55d398326f99059fF775485246999027B3197955",
    decimals: 18,
    enabled: true,
    verified: true,
    note: "BSC mainnet Binance-Peg BSC-USD / USDT-compatible token.",
  },
  {
    chainKey: "bsc",
    chainId: 56,
    tokenSymbol: "USDC",
    tokenAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    decimals: 18,
    enabled: true,
    verified: true,
    note: "BSC mainnet Binance-Peg USDC.",
  },
  {
    chainKey: "arbitrumOne",
    chainId: 42161,
    tokenSymbol: "USDT",
    tokenAddress: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    decimals: 6,
    enabled: true,
    verified: true,
    note: "Arbitrum One USDT-compatible token. On-chain symbol may display as USD₮0 / USDT0.",
  },
  {
    chainKey: "arbitrumOne",
    chainId: 42161,
    tokenSymbol: "USDC",
    tokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
    enabled: true,
    verified: true,
    note: "Arbitrum One native USDC.",
  },
  {
    chainKey: "polygon",
    chainId: 137,
    tokenSymbol: "USDC",
    tokenAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    decimals: 6,
    enabled: true,
    verified: true,
    needsCanary: false,
    note: "Polygon PoS native USDC.",
  },
] as const satisfies readonly SupportedChainToken[];

export type SupportedTokenConfig = (typeof SUPPORTED_CHAIN_TOKENS)[number];

export function getSupportedTokenConfig(
  chainId: number,
  tokenSymbol: StableTokenSymbol,
): SupportedTokenConfig | undefined {
  return SUPPORTED_CHAIN_TOKENS.find(
    (config) => config.chainId === chainId && config.tokenSymbol === tokenSymbol,
  );
}

export function assertSupportedToken(chainId: number, tokenSymbol: StableTokenSymbol): SupportedTokenConfig {
  const config = getSupportedTokenConfig(chainId, tokenSymbol);
  if (config === undefined) {
    throw new Error(`Unsupported EVM 7702 fee token config: chainId=${chainId}, tokenSymbol=${tokenSymbol}`);
  }
  if (!config.enabled) {
    throw new Error(`Disabled EVM 7702 fee token config: chainId=${chainId}, tokenSymbol=${tokenSymbol}`);
  }

  return config;
}
