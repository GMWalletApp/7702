import { getAddress } from "viem";
import { polygon } from "viem/chains";

import { main } from "../sponsored-payment.js";

await main({
  chainId: 137,
  chainName: "Polygon PoS Mainnet",
  viemChain: polygon,
  nativeSymbol: "POL",
  tokenSymbol: "USDC",
  acceptedTokenEnvKeys: ["USDC_TOKEN_ADDRESS"],
  canonicalToken: getAddress("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"),
  explorerTxUrl: (hash) => `PolygonScan: https://polygonscan.com/tx/${hash}`,
});
