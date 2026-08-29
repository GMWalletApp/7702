import { network } from "hardhat";
import { getAddress, isAddress, type Address, type Hex } from "viem";

import { assertExpectedChainId, assertSignerIsOwner, isDryRun } from "../scripts/chain-guard.js";
import {
  envPrefix,
  optionalNetworkAddress,
  requiredNetworkAddress,
  requiredNetworkAddressList,
  requiredNetworkBigInt,
} from "../scripts/env-helpers.js";

const dryRun = isDryRun("CONFIGURE_DRY_RUN");

const connection = await network.create();
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
const prefix = envPrefix(connection.networkName);

// Refuse to go further before reading anything else: a wrong --network is
// unrecoverable once a transaction lands.
assertExpectedChainId(prefix, chainId);

const policyRegistryAddress = requiredNetworkAddress(prefix, "POLICY_REGISTRY");
const sponsorRouterAddress = requiredNetworkAddress(prefix, "SPONSOR_ROUTER");
const sponsorAddress = requiredNetworkAddress(prefix, "SPONSOR_ADDRESS");
const supportedFeeTokens = requiredNetworkAddressList(prefix, "SUPPORTED_FEE_TOKENS");
const unsupportedFeeToken = optionalNetworkAddress(prefix, "UNSUPPORTED_FEE_TOKEN");
const maxGasFeeAmount = requiredNetworkBigInt(prefix, "MAX_GAS_FEE_AMOUNT");
const maxServiceFeeAmount = requiredNetworkBigInt(prefix, "MAX_SERVICE_FEE_AMOUNT");
const maxTotalFeeAmount = requiredNetworkBigInt(prefix, "MAX_TOTAL_FEE_AMOUNT");
const maxCalls = requiredNetworkBigInt(prefix, "MAX_CALLS");

const registryCode = await publicClient.getCode({ address: policyRegistryAddress });
if (registryCode === undefined || registryCode === "0x") {
  throw new Error(`POLICY_REGISTRY has no contract code on ${prefix}: ${policyRegistryAddress}`);
}

const registry = await viem.getContractAt("SponsorPolicyRegistry", policyRegistryAddress);
const [walletClient] = await viem.getWalletClients();
const signer = walletClient.account.address;
const owner = await registry.read.owner();

console.log(`Configuring SponsorPolicyRegistry on ${connection.networkName} (chainId ${chainId})`);
console.log(`  registry:    ${policyRegistryAddress}`);
console.log(`  owner:       ${owner}`);
console.log(`  signer:      ${signer}`);
console.log(`  feeReceiver: ${await registry.read.feeReceiver()}`);
console.log(`  mode:        ${dryRun ? "DRY RUN (no transactions)" : "LIVE"}`);

// Every mutation below is onlyOwner. Checking now turns a wasted on-chain
// revert into an immediate failure, and it still runs under --dry-run so the
// preview tells you whether the live run could actually succeed.
assertSignerIsOwner(owner, signer, "Registry configuration");

/**
 * Labels a token by the <CHAIN>_<NAME>_TOKEN_ADDRESS key that points at it, so
 * the change list reads as "fee token USDT 0x…" rather than a bare address.
 *
 * Deliberately not the on-chain symbol(): every BSC Testnet token is a
 * MockERC20 that reports "MOCK", which identifies nothing. The env key carries
 * the operator's own naming and matches on every chain.
 */
function labelToken(address: Address) {
  const wanted = getAddress(address);
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || !isAddress(value.trim()) || getAddress(value.trim()) !== wanted) {
      continue;
    }
    const name = /^(?:[A-Z0-9]+_)*?([A-Z0-9]+)_TOKEN_ADDRESS$/.exec(key)?.[1];
    if (name !== undefined) {
      return `${name} ${address}`;
    }
  }

  return address;
}

let planned = 0;
let written = 0;

async function applyChange(label: string, needed: boolean, write: () => Promise<Hex>) {
  if (!needed) {
    console.log(`  ${label}: already correct, skipping`);
    return;
  }
  if (dryRun) {
    planned += 1;
    console.log(`  ${label}: WOULD WRITE`);
    return;
  }

  console.log(`  ${label}: writing...`);
  const hash = await write();
  console.log(`    tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted: ${hash}`);
  }
  written += 1;
}

console.log("\nChanges:");

const currentRouter = await registry.read.router();
await applyChange(
  `router → ${sponsorRouterAddress}`,
  getAddress(currentRouter) !== getAddress(sponsorRouterAddress),
  () => registry.write.setRouter([sponsorRouterAddress]),
);

const feePolicy = await registry.read.feePolicy();
const feePolicyChanged =
  feePolicy.maxGasFeeAmount !== maxGasFeeAmount ||
  feePolicy.maxServiceFeeAmount !== maxServiceFeeAmount ||
  feePolicy.maxTotalFeeAmount !== maxTotalFeeAmount ||
  feePolicy.maxCalls !== maxCalls;

if (feePolicyChanged) {
  // Print the full before/after: this is the one change that silently
  // overwrites on-chain policy with whatever .env happens to hold.
  console.log("  fee policy differs from .env:");
  console.log(`    maxGasFeeAmount:     ${feePolicy.maxGasFeeAmount} → ${maxGasFeeAmount}`);
  console.log(`    maxServiceFeeAmount: ${feePolicy.maxServiceFeeAmount} → ${maxServiceFeeAmount}`);
  console.log(`    maxTotalFeeAmount:   ${feePolicy.maxTotalFeeAmount} → ${maxTotalFeeAmount}`);
  console.log(`    maxCalls:            ${feePolicy.maxCalls} → ${maxCalls}`);
}
await applyChange("fee policy", feePolicyChanged, () =>
  registry.write.setFeePolicy([{ maxGasFeeAmount, maxServiceFeeAmount, maxTotalFeeAmount, maxCalls }]),
);

await applyChange(`sponsor ${sponsorAddress}`, !(await registry.read.isSponsor([sponsorAddress])), () =>
  registry.write.setSponsor([sponsorAddress, true]),
);

for (const token of supportedFeeTokens) {
  await applyChange(`fee token ${labelToken(token)}`, !(await registry.read.isSupportedFeeToken([token])), () =>
    registry.write.setSupportedFeeToken([token, true]),
  );
}

if (unsupportedFeeToken !== undefined) {
  const supported = await registry.read.isSupportedFeeToken([unsupportedFeeToken]);
  console.log(`  ${labelToken(unsupportedFeeToken)} left unsupported on purpose: supported=${supported}`);
}

console.log(
  dryRun
    ? `\nDry run: ${planned} transaction(s) would be sent. Re-run without --dry-run to apply.`
    : `\n${written} transaction(s) sent.`,
);

console.log("\nRegistry state:");
console.log(`  paused:  ${await registry.read.paused()}`);
console.log(`  router:  ${await registry.read.router()}`);
console.log(`  sponsor: ${await registry.read.isSponsor([sponsorAddress])}`);
for (const token of supportedFeeTokens) {
  console.log(`  ${labelToken(token)}: ${await registry.read.isSupportedFeeToken([token])}`);
}
const finalFeePolicy = await registry.read.feePolicy();
console.log(`  maxGasFeeAmount:     ${finalFeePolicy.maxGasFeeAmount}`);
console.log(`  maxServiceFeeAmount: ${finalFeePolicy.maxServiceFeeAmount}`);
console.log(`  maxTotalFeeAmount:   ${finalFeePolicy.maxTotalFeeAmount}`);
console.log(`  maxCalls:            ${finalFeePolicy.maxCalls}`);
