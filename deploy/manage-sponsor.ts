// Adds or removes a single sponsor in SponsorPolicyRegistry.
//
// Unlike configure-fee-policy.ts this touches nothing else: no setRouter,
// no setFeePolicy, no fee token changes. Use it when the only thing that
// needs to change is the sponsor allowlist.
//
//   npm run sponsor:add:<chain> -- --dry-run
//   npm run sponsor:add:<chain>
//   npm run sponsor:remove:<chain>
import { network } from "hardhat";
import { formatEther } from "viem";

import { assertExpectedChainId, assertSignerIsOwner, isDryRun } from "../scripts/chain-guard.js";
import { envPrefix, requiredNetworkAddress } from "../scripts/env-helpers.js";

const dryRun = isDryRun("SPONSOR_DRY_RUN");
const allow = process.env.SPONSOR_ACTION !== "remove";

const connection = await network.create();
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
const prefix = envPrefix(connection.networkName);

assertExpectedChainId(prefix, chainId);

const policyRegistryAddress = requiredNetworkAddress(prefix, "POLICY_REGISTRY");
const sponsorAddress = requiredNetworkAddress(prefix, "SPONSOR_ADDRESS");

const code = await publicClient.getCode({ address: policyRegistryAddress });
if (code === undefined || code === "0x") {
  throw new Error(`POLICY_REGISTRY has no contract code on ${prefix}: ${policyRegistryAddress}`);
}

const registry = await viem.getContractAt("SponsorPolicyRegistry", policyRegistryAddress);
const [owner, currentlyAllowed] = await Promise.all([
  registry.read.owner(),
  registry.read.isSponsor([sponsorAddress]),
]);

const [walletClient] = await viem.getWalletClients();
const signer = walletClient.account.address;
const signerBalance = await publicClient.getBalance({ address: signer });

console.log(`SponsorPolicyRegistry sponsor update on ${connection.networkName} (chainId ${chainId})`);
console.log(`  registry:  ${policyRegistryAddress}`);
console.log(`  owner:     ${owner}`);
console.log(`  signer:    ${signer}`);
console.log(`  signer balance: ${formatEther(signerBalance)}`);
console.log(`  sponsor:   ${sponsorAddress}`);
console.log(`  current:   isSponsor=${currentlyAllowed}`);
console.log(`  requested: isSponsor=${allow}`);

assertSignerIsOwner(owner, signer, "setSponsor");

if (currentlyAllowed === allow) {
  console.log("\nAlready in the requested state; nothing to do.");
} else if (dryRun) {
  console.log(`\nDry run enabled; would call setSponsor(${sponsorAddress}, ${allow}) and send 1 transaction.`);
} else {
  console.log(`\nCalling setSponsor(${sponsorAddress}, ${allow})...`);
  const hash = await registry.write.setSponsor([sponsorAddress, allow]);
  console.log(`  tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted: ${hash}`);
  }
  console.log(`  gasUsed: ${receipt.gasUsed}`);

  const confirmed = await registry.read.isSponsor([sponsorAddress]);
  if (confirmed !== allow) {
    throw new Error(`setSponsor did not take effect: isSponsor=${confirmed}, expected=${allow}`);
  }
  console.log(`  confirmed on chain: isSponsor=${confirmed}`);
}
