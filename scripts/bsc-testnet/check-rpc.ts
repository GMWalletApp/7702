import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";

import { requiredEnv, requireBscTestnet } from "./helpers.js";

const rpcUrl = requiredEnv("BSC_TESTNET_RPC_URL");
const client = createPublicClient({
  chain: bscTestnet,
  transport: http(rpcUrl),
});

const chainId = await client.getChainId();
await requireBscTestnet(chainId);

const blockNumber = await client.getBlockNumber();

console.log(`BSC_TESTNET_RPC_URL=${rpcUrl}`);
console.log(`chainId=${chainId}`);
console.log(`latestBlock=${blockNumber}`);
console.log("BSC Testnet RPC check passed.");
