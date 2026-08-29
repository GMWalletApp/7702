import { bscTestnet } from "viem/chains";

import { main } from "../sponsored-payment.js";

// No canonicalToken: BSC Testnet runs against mock tokens, so the guard is
// "FEE_TOKEN_ADDRESS must be one of the two tokens configured in .env"
// rather than a pin to a well-known mainnet address.
await main({
  chainId: 97,
  chainName: "BSC Testnet",
  viemChain: bscTestnet,
  nativeSymbol: "tBNB",
  tokenSymbol: "token",
  acceptedTokenEnvKeys: ["USDT_TOKEN_ADDRESS", "USDC_TOKEN_ADDRESS"],
  explorerTxUrl: (hash) => `BscScan: https://testnet.bscscan.com/tx/${hash}`,
});
