import { network } from "hardhat";
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  getAddress,
  keccak256,
  parseAbiParameters,
  parseEventLogs,
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
import { isDryRun } from "../sponsored-payment-checks.js";
import { assertFeeIntent } from "../chain-guard.js";

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
const feeTokenAddress = requiredNetworkAddress(prefix, "FEE_TOKEN_ADDRESS");
const usdtAddress = requiredNetworkAddress(prefix, "USDT_TOKEN_ADDRESS");
const usdcAddress = requiredNetworkAddress(prefix, "USDC_TOKEN_ADDRESS");
const targetAddress = requiredNetworkAddress(prefix, "TARGET_ADDRESS");
const gasFeeAmount = requiredNetworkBigInt(prefix, "GAS_FEE_AMOUNT");
const serviceFeeAmount = requiredNetworkBigInt(prefix, "SERVICE_FEE_AMOUNT");
const deadlineSeconds = requiredNetworkPositiveSeconds(prefix, "SPONSORED_CALL_DEADLINE_SECONDS");

if (getAddress(feeTokenAddress) !== getAddress(usdtAddress) && getAddress(feeTokenAddress) !== getAddress(usdcAddress)) {
  throw new Error("FEE_TOKEN_ADDRESS must equal USDT_TOKEN_ADDRESS or USDC_TOKEN_ADDRESS for the current test");
}

const { account: userAccount, walletClient: userWalletClient } = makeWalletClient("USER_PRIVATE_KEY", prefix);
const { account: sponsorAccount, walletClient: sponsorWalletClient } = makeWalletClient("SPONSOR_PRIVATE_KEY", prefix);

assertExpectedAddress("USER_ADDRESS", userAccount.address, userAddress);
assertExpectedAddress("SPONSOR_ADDRESS", sponsorAccount.address, sponsorAddress);

const registry = await viem.getContractAt("SponsorPolicyRegistry", policyRegistryAddress);
const account = await viem.getContractAt("Sponsored7702Account", userAddress);
const sponsorRouter = await viem.getContractAt("SponsorRouter", sponsorRouterAddress);
const target = await viem.getContractAt("MockTarget", targetAddress);
const feeToken = await viem.getContractAt("MockERC20", feeTokenAddress);

const feeReceiver = await registry.read.feeReceiver();
const totalFeeAmount = gasFeeAmount + serviceFeeAmount;
assertFeeIntent(totalFeeAmount);
const userFeeBalanceBefore = await feeToken.read.balanceOf([userAddress]);
const receiverFeeBalanceBefore = await feeToken.read.balanceOf([feeReceiver]);

if (!(await registry.read.isSponsor([sponsorAddress]))) {
  throw new Error(`SPONSOR_ADDRESS is not allowed in registry: ${sponsorAddress}`);
}
if (!(await registry.read.isSupportedFeeToken([feeTokenAddress]))) {
  throw new Error(`FEE_TOKEN_ADDRESS is not supported in registry: ${feeTokenAddress}`);
}
if (userFeeBalanceBefore < totalFeeAmount) {
  throw new Error(`USER_ADDRESS fee token balance is too low: balance=${userFeeBalanceBefore}, required=${totalFeeAmount}`);
}

const currentCode = await publicClient.getCode({ address: userAddress });
const sponsoredNonce =
  currentCode === undefined || currentCode === "0x" ? 0n : await account.read.getNonce();
const latestBlock = await publicClient.getBlock();
const deadline = latestBlock.timestamp + deadlineSeconds;

const calls: Call[] = [
  {
    target: targetAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: target.abi,
      functionName: "setValue",
      args: [123n],
    }),
  },
];

const request = {
  account: userAddress,
  nonce: sponsoredNonce,
  deadline,
  sponsor: sponsorAddress,
  feeToken: feeTokenAddress,
  gasFeeAmount,
  serviceFeeAmount,
  feeReceiver,
  callsHash: hashCalls(calls),
};

console.log("BSC Testnet sponsored execution preflight:");
console.log(`  chainId: ${chainId}`);
console.log(`  user: ${userAddress}`);
console.log(`  sponsor: ${sponsorAddress}`);
console.log(`  target: ${targetAddress} (MockTarget.setValue)`);
console.log(`  feeToken: ${feeTokenAddress}`);
console.log(`  feeReceiver: ${feeReceiver}`);
console.log(`  account nonce: ${sponsoredNonce}`);
console.log(`  deadline: ${deadline}`);
console.log(`  calls: ${calls.length}`);
console.log(`  total fee: ${totalFeeAmount}`);

if (isDryRun()) {
  console.log("\nDry run enabled; not signing and not sending a transaction.");
  process.exit(0);
}

console.log("Signing SponsoredCall with user...");
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

console.log("Signing EIP-7702 authorization with user...");
const authorization = await userWalletClient.signAuthorization({
  account: userAccount,
  contractAddress: accountImplementation,
  executor: sponsorAccount,
});

const data = encodeFunctionData({
  abi: sponsorRouter.abi,
  functionName: "executeSponsored",
  args: [request, calls, userSignature],
});

console.log("Sending executeSponsored transaction through SponsorRouter from sponsor...");
const hash = await sponsorWalletClient.sendTransaction({
  account: sponsorAccount,
  to: sponsorRouterAddress,
  data,
  authorizationList: [authorization],
});
console.log(`tx: ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`status: ${receipt.status}`);
console.log(`gasUsed: ${receipt.gasUsed}`);

const feePaidLogs = parseEventLogs({
  abi: account.abi,
  eventName: "FeePaid",
  logs: receipt.logs,
});
if (feePaidLogs.length > 0) {
  const [feePaid] = feePaidLogs;
  console.log("FeePaid:");
  console.log(`  feeToken: ${feePaid.args.feeToken}`);
  console.log(`  feeReceiver: ${feePaid.args.feeReceiver}`);
  console.log(`  gasFeeAmount: ${feePaid.args.gasFeeAmount}`);
  console.log(`  serviceFeeAmount: ${feePaid.args.serviceFeeAmount}`);
  console.log(`  totalFeeAmount: ${feePaid.args.totalFeeAmount}`);
}

const accountNonceAfter = await account.read.getNonce();
const userFeeBalanceAfter = await feeToken.read.balanceOf([userAddress]);
const receiverFeeBalanceAfter = await feeToken.read.balanceOf([feeReceiver]);
const targetValue = await target.read.value();
const targetLastSender = await target.read.lastSender();

console.log("\nFinal state:");
console.log(`  account nonce: ${accountNonceAfter}`);
console.log(`  target value: ${targetValue}`);
console.log(`  target lastSender: ${targetLastSender}`);
console.log(`  user fee balance delta: ${formatUnits(userFeeBalanceBefore - userFeeBalanceAfter, 18)}`);
console.log(`  receiver fee balance delta: ${formatUnits(receiverFeeBalanceAfter - receiverFeeBalanceBefore, 18)}`);
