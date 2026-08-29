import "dotenv/config";

import { readFile } from "node:fs/promises";

import { network } from "hardhat";
import {
  encodeDeployData,
  formatEther,
  getAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import SponsorRouterMsgValueGuard from "../ignition/modules/SponsorRouterMsgValueGuard.js";
import {
  assertExpectedAddress,
  envPrefix,
  requiredNetworkAddress,
  requiredNetworkPrivateKey,
} from "../scripts/env-helpers.js";
import { validateRouterMigrationPreflight } from "../scripts/router-migration-plan.js";

type RouterArtifact = {
  abi: Abi;
  bytecode: Hex;
};

const EXPECTED_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  bsc: 56,
  bscTestnet: 97,
  arbitrumOne: 42161,
};

function migrationEnabled(): boolean {
  return process.env.CONFIRM_ROUTER_MIGRATION?.trim() === "true";
}

const connection = await network.create();
const { ignition, viem } = connection;
const expectedChainId = EXPECTED_CHAIN_IDS[connection.networkName];
if (expectedChainId === undefined) {
  throw new Error(`Router migration is not supported on network ${connection.networkName}`);
}

const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
const prefix = envPrefix(connection.networkName);
const policyRegistryAddress = requiredNetworkAddress(prefix, "POLICY_REGISTRY");
const configuredRouterAddress = requiredNetworkAddress(prefix, "SPONSOR_ROUTER");
const signer = privateKeyToAccount(requiredNetworkPrivateKey(prefix, "PRIVATE_KEY"));
const [walletClient] = await viem.getWalletClients();
assertExpectedAddress(`${prefix}_PRIVATE_KEY / Hardhat wallet`, walletClient.account.address, signer.address);

const registry = await viem.getContractAt("SponsorPolicyRegistry", policyRegistryAddress, {
  client: { public: publicClient, wallet: walletClient },
});
const [owner, currentRouter, signerNativeBalance, gasPrice] = await Promise.all([
  registry.read.owner(),
  registry.read.router(),
  publicClient.getBalance({ address: signer.address }),
  publicClient.getGasPrice(),
]);

const artifact = JSON.parse(
  await readFile("artifacts/contracts/router/SponsorRouter.sol/SponsorRouter.json", "utf8"),
) as RouterArtifact;
const deploymentData = encodeDeployData({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [policyRegistryAddress],
});
const estimatedDeployGas = await publicClient.estimateGas({
  account: signer.address,
  data: deploymentData,
});
const setRouterGasBuffer = 100_000n;
const estimatedGasWithBuffer = estimatedDeployGas + setRouterGasBuffer;
const minimumNativeBalance = estimatedGasWithBuffer * gasPrice * 2n;

validateRouterMigrationPreflight({
  actualChainId: chainId,
  expectedChainId,
  owner,
  signer: signer.address,
  currentRouter,
  expectedCurrentRouter: configuredRouterAddress,
  signerNativeBalance,
  minimumNativeBalance,
});

console.log(`SponsorRouter migration preflight for ${connection.networkName}:`);
console.log(`  chainId:                 ${chainId}`);
console.log(`  registry:                ${getAddress(policyRegistryAddress)}`);
console.log(`  registry owner/signer:   ${getAddress(signer.address)}`);
console.log(`  current Router:          ${getAddress(currentRouter)}`);
console.log(`  deploy gas estimate:     ${estimatedDeployGas}`);
console.log(`  gas price:               ${gasPrice}`);
console.log(`  signer native balance:   ${formatEther(signerNativeBalance)}`);
console.log(`  safety minimum balance:  ${formatEther(minimumNativeBalance)}`);
console.log(`  migration armed:         ${migrationEnabled()}`);

if (!migrationEnabled()) {
  console.log("Dry run only; set CONFIRM_ROUTER_MIGRATION=true to deploy and switch the Registry.");
  process.exit(0);
}

const deploymentId = `chain-${chainId}-sponsor-router-msg-value-guard-v1`;
const { sponsorRouter } = await ignition.deploy(SponsorRouterMsgValueGuard, {
  parameters: {
    SponsorRouterMsgValueGuard: {
      policyRegistry: policyRegistryAddress,
    },
  },
  deploymentId,
  displayUi: true,
});
const candidateRouter = getAddress(sponsorRouter.address);
if (candidateRouter === getAddress(currentRouter)) {
  console.log(`Registry already uses migrated Router: ${candidateRouter}`);
  process.exit(0);
}

const candidateCode = await publicClient.getCode({ address: candidateRouter });
if (candidateCode === undefined || candidateCode === "0x") {
  throw new Error(`Migrated Router has no code: ${candidateRouter}`);
}
const candidate = await viem.getContractAt("SponsorRouter", candidateRouter);
const candidateRegistry = await candidate.read.policyRegistry();
if (getAddress(candidateRegistry) !== getAddress(policyRegistryAddress)) {
  throw new Error(
    `Migrated Router points to the wrong Registry: expected=${policyRegistryAddress}, actual=${candidateRegistry}`,
  );
}

const setRouterHash = await registry.write.setRouter([candidateRouter]);
console.log(`  setRouter tx: ${setRouterHash}`);
const setRouterReceipt = await publicClient.waitForTransactionReceipt({ hash: setRouterHash });
if (setRouterReceipt.status !== "success") {
  throw new Error(`Registry setRouter reverted: ${setRouterHash}`);
}
const finalRouter = await registry.read.router();
if (getAddress(finalRouter) !== candidateRouter) {
  throw new Error(`Registry Router readback mismatch: expected=${candidateRouter}, actual=${finalRouter}`);
}

console.log("Router migration completed:");
console.log(`  deployment id: ${deploymentId}`);
console.log(`  new Router:    ${candidateRouter}`);
console.log(`  setRouter tx:  ${setRouterHash}`);
console.log(`  block:         ${setRouterReceipt.blockNumber}`);
console.log(`Update ${prefix}_SPONSOR_ROUTER to ${candidateRouter}.`);
