import { getAddress } from "viem";
import { mainnet } from "viem/chains";

import { main } from "../sponsored-payment.js";

await main({
  chainId: 1,
  chainName: "Ethereum Mainnet",
  viemChain: mainnet,
  nativeSymbol: "ETH",
  tokenSymbol: "USDC",
  acceptedTokenEnvKeys: ["USDC_TOKEN_ADDRESS"],
  canonicalToken: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
  explorerTxUrl: (hash) => `Etherscan: https://etherscan.io/tx/${hash}`,
});
