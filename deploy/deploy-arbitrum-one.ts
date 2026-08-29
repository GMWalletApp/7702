import { network } from "hardhat";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import Sponsored7702AccountModule from "../ignition/modules/Sponsored7702Account.js";
import {
  assertExpectedAddress,
  envPrefix,
  requiredNetworkAddress,
  requiredNetworkPrivateKey,
} from "../scripts/env-helpers.js";

const ARBITRUM_ONE_CHAIN_ID = 42161;

const connection = await network.create();
const { ignition, viem } = connection;
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
if (chainId !== ARBITRUM_ONE_CHAIN_ID) {
  throw new Error(`Expected Arbitrum One chainId ${ARBITRUM_ONE_CHAIN_ID}, got ${chainId}`);
}

const prefix = envPrefix(connection.networkName);
const initialOwner = requiredNetworkAddress(prefix, "INITIAL_OWNER");
const initialFeeReceiver = requiredNetworkAddress(prefix, "INITIAL_FEE_RECEIVER");
const deployer = privateKeyToAccount(requiredNetworkPrivateKey(prefix, "PRIVATE_KEY"));

assertExpectedAddress(`${prefix}_PRIVATE_KEY / INITIAL_OWNER`, deployer.address, initialOwner);

console.log(`Deploying Sponsored7702Account module to Arbitrum One (chainId ${chainId})...`);
console.log(`Deployer/owner:      ${getAddress(deployer.address)}`);
console.log(`Initial feeReceiver: ${initialFeeReceiver}`);

const deploymentId = process.env.IGNITION_DEPLOYMENT_ID?.trim() || `chain-${chainId}-router-v2`;

const { accountImplementation, policyRegistry, sponsorRouter } = await ignition.deploy(Sponsored7702AccountModule, {
  parameters: {
    Sponsored7702AccountModule: {
      initialOwner,
      initialFeeReceiver,
    },
  },
  deploymentId,
  displayUi: true,
});

console.log(`\nIgnition deployment id: ${deploymentId}`);
console.log("\nAdd these to .env:");
console.log(`${prefix}_POLICY_REGISTRY=${policyRegistry.address}`);
console.log(`${prefix}_ACCOUNT_IMPLEMENTATION=${accountImplementation.address}`);
console.log(`${prefix}_SPONSOR_ROUTER=${sponsorRouter.address}`);
console.log("\nThen run:");
console.log("npm run configure:arbitrum-one");
console.log("npm run sponsored:payment:arbitrum-one");
