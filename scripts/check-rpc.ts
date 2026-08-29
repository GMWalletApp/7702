import { network } from "hardhat";

const connection = await network.create();
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
const blockNumber = await publicClient.getBlockNumber();

console.log(`network=${connection.networkName}`);
console.log(`chainId=${chainId}`);
console.log(`latestBlock=${blockNumber}`);
console.log("RPC check passed.");
