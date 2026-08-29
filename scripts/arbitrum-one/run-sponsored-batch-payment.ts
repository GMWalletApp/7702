import "dotenv/config";

import { network } from "hardhat";

import { envPrefix, requiredNetworkAddressList, requiredNetworkBigIntList } from "../env-helpers.js";

const connection = await network.create();
const prefix = envPrefix(connection.networkName);

const recipients = requiredNetworkAddressList(prefix, "PAYMENT_RECIPIENTS");
const amounts = requiredNetworkBigIntList(prefix, "PAYMENT_AMOUNTS");

if (recipients.length < 2) {
  throw new Error(`${prefix}_PAYMENT_RECIPIENTS must contain at least 2 addresses for the batch payment test`);
}
if (recipients.length !== amounts.length) {
  throw new Error(
    `${prefix}_PAYMENT_RECIPIENTS length ${recipients.length} must match ${prefix}_PAYMENT_AMOUNTS length ${amounts.length}`,
  );
}
if (amounts.some((amount) => amount === 0n)) {
  throw new Error(`${prefix}_PAYMENT_AMOUNTS must contain only positive amounts`);
}

console.log(`Running Arbitrum One sponsored batch payment with ${recipients.length} calls...`);
await import("./run-sponsored-token-payment.js");
