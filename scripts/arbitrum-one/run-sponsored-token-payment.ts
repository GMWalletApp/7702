import { getAddress } from "viem";
import { arbitrum } from "viem/chains";

import { main } from "../sponsored-payment.js";

await main({
  chainId: 42161,
  chainName: "Arbitrum One",
  viemChain: arbitrum,
  nativeSymbol: "ETH",
  tokenSymbol: "USDC",
  acceptedTokenEnvKeys: ["USDC_TOKEN_ADDRESS"],
  canonicalToken: getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"),
  explorerTxUrl: (hash) => `Arbiscan: https://arbiscan.io/tx/${hash}`,
});
