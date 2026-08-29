import { network } from "hardhat";
import { formatUnits, parseUnits } from "viem";

import { envPrefix, optionalNetworkAddress, requireBscTestnet } from "../scripts/bsc-testnet/helpers.js";

const connection = await network.create();
const { viem } = connection;
const publicClient = await viem.getPublicClient();
await requireBscTestnet(await publicClient.getChainId());
const prefix = envPrefix(connection.networkName);

const userAddress = optionalNetworkAddress(prefix, "USER_ADDRESS");
const mintAmount = parseUnits("100", 18);

console.log("Deploying BSC Testnet mock target and mock repayment tokens...");

const target = await viem.deployContract("MockTarget");
const mockUsdt = await viem.deployContract("MockERC20");
const mockUsdc = await viem.deployContract("MockERC20");
const mockUsdg = await viem.deployContract("MockERC20");

console.log(`MockTarget: ${target.address}`);
console.log(`Mock USDT:  ${mockUsdt.address}`);
console.log(`Mock USDC:  ${mockUsdc.address}`);
console.log(`Mock USDG:  ${mockUsdg.address}`);

if (userAddress !== undefined) {
  console.log(`Minting ${formatUnits(mintAmount, 18)} mock USDT/USDC/USDG to USER_ADDRESS ${userAddress}...`);
  await mockUsdt.write.mint([userAddress, mintAmount]);
  await mockUsdc.write.mint([userAddress, mintAmount]);
  await mockUsdg.write.mint([userAddress, mintAmount]);
}

console.log("\nAdd these to .env:");
console.log(`${prefix}_TARGET_ADDRESS=${target.address}`);
console.log(`${prefix}_USDT_TOKEN_ADDRESS=${mockUsdt.address}`);
console.log(`${prefix}_USDC_TOKEN_ADDRESS=${mockUsdc.address}`);
console.log(`${prefix}_USDG_TOKEN_ADDRESS=${mockUsdg.address}`);
console.log(`${prefix}_FEE_TOKEN_ADDRESS=${mockUsdc.address}`);
console.log(`${prefix}_GAS_FEE_AMOUNT=1000000000000000`);
console.log(`${prefix}_SERVICE_FEE_AMOUNT=0`);
console.log(`${prefix}_MAX_GAS_FEE_AMOUNT=1000000000000000`);
console.log(`${prefix}_MAX_SERVICE_FEE_AMOUNT=0`);
console.log(`${prefix}_MAX_TOTAL_FEE_AMOUNT=1000000000000000`);
console.log(`${prefix}_MAX_CALLS=10`);
