import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

import { requiredNetworkEnv, requiredNetworkPrivateKey } from "../env-helpers.js";

export {
  assertExpectedAddress,
  envPrefix,
  networkEnv,
  optionalAddress,
  optionalNetworkAddress,
  optionalEnv,
  requiredAddress,
  requiredBigInt,
  requiredNetworkAddress,
  requiredNetworkBigInt,
  requiredNetworkEnv,
  requiredNetworkPositiveSeconds,
  requiredEnv,
  requiredPositiveSeconds,
  requiredPrivateKey,
} from "../env-helpers.js";

export const BSC_TESTNET_CHAIN_ID = 97;
export const BSC_TESTNET_ENV_PREFIX = "BSC_TESTNET";

export function makeWalletClient(privateKeyName: string, prefix = BSC_TESTNET_ENV_PREFIX) {
  const account = privateKeyToAccount(requiredNetworkPrivateKey(prefix, privateKeyName));
  const rpcUrl = requiredNetworkEnv(prefix, "RPC_URL");
  const walletClient = createWalletClient({
    account,
    chain: bscTestnet,
    transport: http(rpcUrl),
  });

  return { account, walletClient };
}

export async function requireBscTestnet(chainId: number) {
  if (chainId !== BSC_TESTNET_CHAIN_ID) {
    throw new Error(`Expected BSC Testnet chainId ${BSC_TESTNET_CHAIN_ID}, got ${chainId}`);
  }
}
