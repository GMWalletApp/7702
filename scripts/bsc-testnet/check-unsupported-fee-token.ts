import { network } from "hardhat";
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

import {
  assertExpectedAddress,
  envPrefix,
  makeWalletClient,
  requiredNetworkAddress,
  requiredNetworkBigInt,
  requiredNetworkPositiveSeconds,
  requireBscTestnet,
} from "./helpers.js";

const CALL_TYPEHASH = keccak256(new TextEncoder().encode("Call(address target,uint256 value,bytes32 dataHash)"));

const sponsoredCallTypes = {
  SponsoredCall: [
    { name: "account", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "sponsor", type: "address" },
    { name: "feeToken", type: "address" },
    { name: "gasFeeAmount", type: "uint256" },
    { name: "serviceFeeAmount", type: "uint256" },
    { name: "feeReceiver", type: "address" },
    { name: "callsHash", type: "bytes32" },
  ],
} as const;

type Call = {
  target: Address;
  value: bigint;
  data: Hex;
};

function hashCall(call: Call): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32,address,uint256,bytes32"), [
      CALL_TYPEHASH,
      call.target,
      call.value,
      keccak256(call.data),
    ]),
  );
}

function hashCalls(calls: Call[]): Hex {
  return keccak256(concat(calls.map(hashCall)));
}

const connection = await network.create();
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
await requireBscTestnet(chainId);
const prefix = envPrefix(connection.networkName);

const policyRegistryAddress = requiredNetworkAddress(prefix, "POLICY_REGISTRY");
const accountImplementation = requiredNetworkAddress(prefix, "ACCOUNT_IMPLEMENTATION");
const sponsorRouterAddress = requiredNetworkAddress(prefix, "SPONSOR_ROUTER");
const userAddress = requiredNetworkAddress(prefix, "USER_ADDRESS");
const sponsorAddress = requiredNetworkAddress(prefix, "SPONSOR_ADDRESS");
const unsupportedFeeTokenAddress = requiredNetworkAddress(prefix, "USDG_TOKEN_ADDRESS");
const targetAddress = requiredNetworkAddress(prefix, "TARGET_ADDRESS");
const gasFeeAmount = requiredNetworkBigInt(prefix, "GAS_FEE_AMOUNT");
const serviceFeeAmount = requiredNetworkBigInt(prefix, "SERVICE_FEE_AMOUNT");
const deadlineSeconds = requiredNetworkPositiveSeconds(prefix, "SPONSORED_CALL_DEADLINE_SECONDS");

const { account: userAccount, walletClient: userWalletClient } = makeWalletClient("USER_PRIVATE_KEY", prefix);
const { account: sponsorAccount } = makeWalletClient("SPONSOR_PRIVATE_KEY", prefix);

assertExpectedAddress("USER_ADDRESS", userAccount.address, userAddress);
assertExpectedAddress("SPONSOR_ADDRESS", sponsorAccount.address, sponsorAddress);

const registry = await viem.getContractAt("SponsorPolicyRegistry", policyRegistryAddress);
const account = await viem.getContractAt("Sponsored7702Account", userAddress);
const sponsorRouter = await viem.getContractAt("SponsorRouter", sponsorRouterAddress);
const target = await viem.getContractAt("MockTarget", targetAddress);

if (await registry.read.isSupportedFeeToken([unsupportedFeeTokenAddress])) {
  throw new Error(`USDG_TOKEN_ADDRESS is already supported; this negative test requires it to be unsupported`);
}

const currentCode = await publicClient.getCode({ address: userAddress });
const sponsoredNonce = currentCode === undefined || currentCode === "0x" ? 0n : await account.read.getNonce();
const latestBlock = await publicClient.getBlock();
const deadline = latestBlock.timestamp + deadlineSeconds;
const feeReceiver = await registry.read.feeReceiver();

const calls: Call[] = [
  {
    target: targetAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: target.abi,
      functionName: "setValue",
      args: [456n],
    }),
  },
];

const request = {
  account: userAddress,
  nonce: sponsoredNonce,
  deadline,
  sponsor: sponsorAddress,
  feeToken: unsupportedFeeTokenAddress,
  gasFeeAmount,
  serviceFeeAmount,
  feeReceiver,
  callsHash: hashCalls(calls),
};

const userSignature = await userWalletClient.signTypedData({
  account: userAccount,
  domain: {
    name: "Sponsored7702Account",
    version: "1",
    chainId,
    verifyingContract: userAddress,
  },
  types: sponsoredCallTypes,
  primaryType: "SponsoredCall",
  message: request,
});

const authorization = await userWalletClient.signAuthorization({
  account: userAccount,
  contractAddress: accountImplementation,
  executor: sponsorAccount,
});

try {
  await publicClient.simulateContract({
    account: sponsorAddress,
    address: sponsorRouterAddress,
    abi: sponsorRouter.abi,
    functionName: "executeSponsored",
    args: [request, calls, userSignature],
    authorizationList: [authorization],
  });

  throw new Error("Expected UnsupportedFeeToken revert, but simulation succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("UnsupportedFeeToken")) {
    throw error;
  }

  console.log("Unsupported fee token check passed.");
  console.log(`USDG_TOKEN_ADDRESS ${getAddress(unsupportedFeeTokenAddress)} is not supported by registry.`);
  console.log("executeSponsored correctly reverts with UnsupportedFeeToken.");
}
