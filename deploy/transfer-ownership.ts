// Ownable2Step ownership handover for SponsorPolicyRegistry.
//
// Two transactions signed by two different accounts:
//   1. transfer — current owner nominates the new owner (sets pendingOwner)
//   2. accept   — the nominated account claims it (becomes owner)
//
// Ownership only moves on step 2, so a typo in step 1 is recoverable: nominate
// again, or the wrong address simply never accepts.
//
//   npm run owner:transfer:<chain> -- --dry-run   # signed by current owner
//   npm run owner:accept:<chain>                  # signed by the new owner
//
// The signer comes from <CHAIN>_PRIVATE_KEY, so the two steps need different
// values in .env. NEW_OWNER (or <CHAIN>_NEW_OWNER) names the incoming owner.
import { network } from "hardhat";
import { formatEther, getAddress } from "viem";

import { assertExpectedChainId, isDryRun } from "../scripts/chain-guard.js";
import { envPrefix, requiredNetworkAddress } from "../scripts/env-helpers.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const dryRun = isDryRun("OWNERSHIP_DRY_RUN");
const accepting = process.env.OWNERSHIP_ACTION === "accept";

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
const [owner, pendingOwner] = await Promise.all([registry.read.owner(), registry.read.pendingOwner()]);
const signerBalance = await publicClient.getBalance({ address: signer });

console.log(`SponsorPolicyRegistry ownership ${accepting ? "accept" : "transfer"} on ${connection.networkName} (chainId ${chainId})`);
console.log(`  registry:       ${policyRegistryAddress}`);
console.log(`  current owner:  ${owner}`);
console.log(`  pending owner:  ${pendingOwner === ZERO_ADDRESS ? "(none)" : pendingOwner}`);
console.log(`  signer:         ${signer}`);
console.log(`  signer balance: ${formatEther(signerBalance)}`);

if (accepting) {
  if (getAddress(pendingOwner) === getAddress(ZERO_ADDRESS)) {
    throw new Error("No pending owner is set. Run the transfer step first, signed by the current owner.");
  }
  if (getAddress(pendingOwner) !== getAddress(signer)) {
    throw new Error(
      `Signer ${signer} is not the pending owner ${pendingOwner}. ` +
        `acceptOwnership must be signed by the nominated account — set ${prefix}_PRIVATE_KEY to its key.`,
    );
  }

  if (dryRun) {
    console.log(`\nDry run enabled; would call acceptOwnership() and hand ownership to ${signer}.`);
  } else {
    console.log("\nCalling acceptOwnership()...");
    const hash = await registry.write.acceptOwnership();
    console.log(`  tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Transaction reverted: ${hash}`);
    }

    const confirmedOwner = await registry.read.owner();
    if (getAddress(confirmedOwner) !== getAddress(signer)) {
      throw new Error(`Ownership did not move: owner=${confirmedOwner}, expected=${signer}`);
    }
    console.log(`  confirmed on chain: owner=${confirmedOwner}`);
    console.log("\nOwnership transfer complete. Update the deployer key used by the configure scripts.");
  }
} else {
  const newOwner = requiredNetworkAddress(prefix, "NEW_OWNER");

  if (getAddress(owner) !== getAddress(signer)) {
    throw new Error(
      `Signer ${signer} is not the current owner ${owner}. ` +
        `transferOwnership is onlyOwner — set ${prefix}_PRIVATE_KEY to the owner key.`,
    );
  }
  if (getAddress(newOwner) === getAddress(owner)) {
    throw new Error(`NEW_OWNER ${newOwner} is already the owner; nothing to transfer.`);
  }

  console.log(`  new owner:      ${newOwner}`);

  if (getAddress(pendingOwner) === getAddress(newOwner)) {
    console.log("\nThis account is already the pending owner; nothing to do.");
    console.log(`Next step: run the accept step signed by ${newOwner}.`);
  } else if (dryRun) {
    console.log(`\nDry run enabled; would call transferOwnership(${newOwner}) and send 1 transaction.`);
    console.log("Ownership would NOT move yet — the new owner must then run the accept step.");
  } else {
    console.log(`\nCalling transferOwnership(${newOwner})...`);
    const hash = await registry.write.transferOwnership([newOwner]);
    console.log(`  tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Transaction reverted: ${hash}`);
    }

    const confirmedPending = await registry.read.pendingOwner();
    if (getAddress(confirmedPending) !== getAddress(newOwner)) {
      throw new Error(`Nomination did not take effect: pendingOwner=${confirmedPending}, expected=${newOwner}`);
    }
    console.log(`  confirmed on chain: pendingOwner=${confirmedPending}`);
    console.log(`\nOwnership has NOT moved yet. ${newOwner} must run the accept step to complete it.`);
    console.log(`  owner is still ${await registry.read.owner()}`);
  }
}
