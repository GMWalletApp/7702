// Emergency stop for sponsored execution.
//
// Pausing the registry blocks SponsorRouter.executeSponsored on that chain.
// It does NOT block Sponsored7702Account.executeFromSelf — a paused registry
// stops us from sponsoring, it does not lock users out of their own accounts.
//
//   npm run registry:pause:<chain> -- --dry-run
//   npm run registry:pause:<chain>
//   npm run registry:unpause:<chain>
import { network } from "hardhat";
import { formatEther } from "viem";

import { assertExpectedChainId, assertSignerIsOwner, isDryRun } from "../scripts/chain-guard.js";
import { envPrefix, requiredNetworkAddress } from "../scripts/env-helpers.js";

const dryRun = isDryRun("PAUSE_DRY_RUN");
const shouldPause = process.env.PAUSE_ACTION !== "unpause";

const connection = await network.create();
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
const prefix = envPrefix(connection.networkName);

assertExpectedChainId(prefix, chainId);

const policyRegistryAddress = requiredNetworkAddress(prefix, "POLICY_REGISTRY");
const code = await publicClient.getCode({ address: policyRegistryAddress });
if (code === undefined || code === "0x") {
  throw new Error(`POLICY_REGISTRY has no contract code on ${prefix}: ${policyRegistryAddress}`);
}

const registry = await viem.getContractAt("SponsorPolicyRegistry", policyRegistryAddress);
const [walletClient] = await viem.getWalletClients();
const signer = walletClient.account.address;
const [owner, currentlyPaused] = await Promise.all([registry.read.owner(), registry.read.paused()]);
const signerBalance = await publicClient.getBalance({ address: signer });

console.log(`SponsorPolicyRegistry ${shouldPause ? "pause" : "unpause"} on ${connection.networkName} (chainId ${chainId})`);
console.log(`  registry:       ${policyRegistryAddress}`);
console.log(`  owner:          ${owner}`);
console.log(`  signer:         ${signer}`);
console.log(`  signer balance: ${formatEther(signerBalance)}`);
console.log(`  current:        paused=${currentlyPaused}`);
console.log(`  requested:      paused=${shouldPause}`);

assertSignerIsOwner(owner, signer, shouldPause ? "pause" : "unpause");

if (currentlyPaused === shouldPause) {
  console.log("\nAlready in the requested state; nothing to do.");
} else if (dryRun) {
  console.log(`\nDry run enabled; would call ${shouldPause ? "pause" : "unpause"}() and send 1 transaction.`);
} else {
  console.log(`\nCalling ${shouldPause ? "pause" : "unpause"}()...`);
  const hash = shouldPause ? await registry.write.pause() : await registry.write.unpause();
  console.log(`  tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted: ${hash}`);
  }
  console.log(`  gasUsed: ${receipt.gasUsed}`);

  const confirmed = await registry.read.paused();
  if (confirmed !== shouldPause) {
    throw new Error(`Pause state did not take effect: paused=${confirmed}, expected=${shouldPause}`);
  }
  console.log(`  confirmed on chain: paused=${confirmed}`);
}

if (shouldPause && !dryRun) {
  console.log("\nSponsored execution is now blocked on this chain.");
  console.log("executeFromSelf is unaffected: users can still move their own funds.");
}
