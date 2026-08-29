import { getAddress } from "viem";
import { bsc } from "viem/chains";

import { main } from "../sponsored-payment.js";

await main({
  chainId: 56,
  chainName: "BSC Mainnet",
  viemChain: bsc,
  nativeSymbol: "BNB",
  tokenSymbol: "USDT",
  acceptedTokenEnvKeys: ["USDT_TOKEN_ADDRESS"],
  canonicalToken: getAddress("0x55d398326f99059fF775485246999027B3197955"),
  explorerTxUrl: (hash) => `BscScan: https://bscscan.com/tx/${hash}`,
});
