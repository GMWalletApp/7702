import { network } from "hardhat";

import Sponsored7702AccountModule from "../ignition/modules/Sponsored7702Account.js";
import { envPrefix, requiredNetworkAddress } from "../scripts/env-helpers.js";

const connection = await network.create();
const { ignition, viem } = connection;
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
const prefix = envPrefix(connection.networkName);
const initialOwner = requiredNetworkAddress(prefix, "INITIAL_OWNER");
const initialFeeReceiver = requiredNetworkAddress(prefix, "INITIAL_FEE_RECEIVER");

console.log(`Deploying Sponsored7702Account module to ${connection.networkName} (chainId ${chainId})...`);
console.log(`Initial owner:       ${initialOwner}`);
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
