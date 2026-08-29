import { network } from "hardhat";
import {
  concat,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseAbiParameters,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

import {
  assertExpectedAddress,
  envPrefix,
  requiredNetworkAddress,
  requiredNetworkBigInt,
  requiredNetworkEnv,
  requiredNetworkPositiveSeconds,
  requiredNetworkPrivateKey,
} from "../env-helpers.js";
import { assertSimulationStateUnchanged, type SimulationState } from "../simulation-state.js";

const BSC_TESTNET_CHAIN_ID = 97;
const CALL_TYPEHASH = keccak256(new TextEncoder().encode("Call(address target,uint256 value,bytes32 dataHash)"));

const sponsorRouterSimulationAbi = parseAbi([
  "function executeSponsored((address account,uint256 nonce,uint256 deadline,address sponsor,address feeToken,uint256 gasFeeAmount,uint256 serviceFeeAmount,address feeReceiver,bytes32 callsHash) request,(address target,uint256 value,bytes data)[] calls,bytes userSignature) payable returns (bytes[] returnData)",
  "error UnexpectedNativeValue()",
  "error NotSponsor()",
  "error InvalidSponsor()",
  "error AccountNotDelegated()",
  "error GasFeeTooHigh()",
  "error UnsupportedFeeToken()",
  "error InvalidFeeReceiver()",
  "error TooManyCalls()",
  "error InvalidNonce()",
  "error SignatureExpired()",
  "error InvalidSignature()",
]) as Abi;

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

type SponsoredCall = {
  account: Address;
  nonce: bigint;
  deadline: bigint;
  sponsor: Address;
  feeToken: Address;
  gasFeeAmount: bigint;
  serviceFeeAmount: bigint;
  feeReceiver: Address;
  callsHash: Hex;
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

function getDelegationTarget(code: Hex | undefined): Address | undefined {
  if (code === undefined || code === "0x") {
    return undefined;
  }

  const normalizedCode = code.toLowerCase();
  if (normalizedCode.startsWith("0xef0100") && normalizedCode.length === 48) {
    return getAddress(`0x${normalizedCode.slice(8)}`);
  }

  return undefined;
}

function errorObject(error: unknown): Record<string, unknown> | undefined {
  return typeof error === "object" && error !== null ? (error as Record<string, unknown>) : undefined;
}

function errorText(error: unknown): string {
  const object = errorObject(error);
  if (object === undefined) {
    return String(error);
  }

  const data = errorObject(object.data);
  const parts = [
    typeof data?.errorName === "string" ? data.errorName : undefined,
    typeof object.shortMessage === "string" ? object.shortMessage : undefined,
    typeof object.details === "string" ? object.details : undefined,
    typeof object.message === "string" ? object.message : undefined,
    object.cause === undefined ? undefined : errorText(object.cause),
  ];

  return parts.filter((part): part is string => part !== undefined).join("\n");
}

async function expectRevert(name: string, expectedError: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    const text = errorText(error);
    if (!text.includes(expectedError)) {
      throw new Error(`${name}: expected ${expectedError}, got:\n${text}`);
    }
    console.log(`  ✅ ${name}: ${expectedError}`);
    return;
  }

  throw new Error(`${name}: expected ${expectedError}, but simulation succeeded`);
}

const connection = await network.create();
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
if (chainId !== BSC_TESTNET_CHAIN_ID) {
  throw new Error(`Expected BSC Testnet chainId ${BSC_TESTNET_CHAIN_ID}, got ${chainId}`);
}

const prefix = envPrefix(connection.networkName);
const policyRegistryAddress = requiredNetworkAddress(prefix, "POLICY_REGISTRY");
const accountImplementation = requiredNetworkAddress(prefix, "ACCOUNT_IMPLEMENTATION");
const sponsorRouterAddress = requiredNetworkAddress(prefix, "SPONSOR_ROUTER");
const userAddress = requiredNetworkAddress(prefix, "USER_ADDRESS");
const sponsorAddress = requiredNetworkAddress(prefix, "SPONSOR_ADDRESS");
const merchantAddress = requiredNetworkAddress(prefix, "MERCHANT_ADDRESS");
const feeTokenAddress = requiredNetworkAddress(prefix, "FEE_TOKEN_ADDRESS");
const paymentAmount = requiredNetworkBigInt(prefix, "PAYMENT_AMOUNT");
const gasFeeAmount = requiredNetworkBigInt(prefix, "GAS_FEE_AMOUNT");
const serviceFeeAmount = requiredNetworkBigInt(prefix, "SERVICE_FEE_AMOUNT");
const deadlineSeconds = requiredNetworkPositiveSeconds(prefix, "SPONSORED_CALL_DEADLINE_SECONDS");

const userAccount = privateKeyToAccount(requiredNetworkPrivateKey(prefix, "USER_PRIVATE_KEY"));
const userWalletClient = createWalletClient({
  account: userAccount,
  chain: bscTestnet,
  transport: http(requiredNetworkEnv(prefix, "RPC_URL")),
});
assertExpectedAddress("USER_ADDRESS", userAccount.address, userAddress);

const registry = await viem.getContractAt("SponsorPolicyRegistry", policyRegistryAddress);
const account = await viem.getContractAt("Sponsored7702Account", userAddress);
const feeToken = await viem.getContractAt("MockERC20", feeTokenAddress);
const feeReceiver = await registry.read.feeReceiver();
const feePolicy = await registry.read.feePolicy();

if (!(await registry.read.isSponsor([sponsorAddress]))) {
  throw new Error(`Sponsor is not allowlisted: ${sponsorAddress}`);
}
if (!(await registry.read.isSupportedFeeToken([feeTokenAddress]))) {
  throw new Error(`Fee token is not supported: ${feeTokenAddress}`);
}

const userCode = await publicClient.getCode({ address: userAddress });
const delegationTarget = getDelegationTarget(userCode);
if (delegationTarget !== undefined && getAddress(delegationTarget) !== getAddress(accountImplementation)) {
  throw new Error(`USER_ADDRESS is delegated to ${delegationTarget}, expected ${accountImplementation}`);
}

const authorizationList =
  delegationTarget === undefined
    ? [
        await userWalletClient.signAuthorization({
          account: userAccount,
          contractAddress: accountImplementation,
          executor: sponsorAddress,
        }),
      ]
    : undefined;

async function signRequest(request: SponsoredCall): Promise<Hex> {
  return userWalletClient.signTypedData({
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
}

async function simulateSponsored(params: {
  request: SponsoredCall;
  calls: Call[];
  signature: Hex;
  sender?: Address;
  value?: bigint;
}) {
  return publicClient.simulateContract({
    account: params.sender ?? sponsorAddress,
    address: sponsorRouterAddress,
    abi: sponsorRouterSimulationAbi,
    functionName: "executeSponsored",
    args: [params.request, params.calls, params.signature],
    value: params.value,
    ...(authorizationList === undefined ? {} : { authorizationList }),
  });
}

async function readState(): Promise<SimulationState> {
  return {
    nonce: delegationTarget === undefined ? 0n : await account.read.getNonce(),
    userBalance: await feeToken.read.balanceOf([userAddress]),
    merchantBalance: await feeToken.read.balanceOf([merchantAddress]),
    feeReceiverBalance: await feeToken.read.balanceOf([feeReceiver]),
  };
}

const latestBlock = await publicClient.getBlock();
const stateBefore = await readState();
const validCalls: Call[] = [
  {
    target: feeTokenAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [merchantAddress, paymentAmount],
    }),
  },
];
const validRequest: SponsoredCall = {
  account: userAddress,
  nonce: stateBefore.nonce,
  deadline: latestBlock.timestamp + deadlineSeconds,
  sponsor: sponsorAddress,
  feeToken: feeTokenAddress,
  gasFeeAmount,
  serviceFeeAmount,
  feeReceiver,
  callsHash: hashCalls(validCalls),
};
const validSignature = await signRequest(validRequest);

console.log("BSC Testnet live-contract simulation matrix:");
await simulateSponsored({ request: validRequest, calls: validCalls, signature: validSignature });
console.log("  ✅ valid sponsored request");

await expectRevert("nonzero native value", "UnexpectedNativeValue", () =>
  simulateSponsored({ request: validRequest, calls: validCalls, signature: validSignature, value: 1n }),
);
await expectRevert("non-sponsor sender", "NotSponsor", () =>
  simulateSponsored({
    request: validRequest,
    calls: validCalls,
    signature: validSignature,
    sender: merchantAddress,
  }),
);
await expectRevert("mismatched sponsor", "InvalidSponsor", () =>
  simulateSponsored({
    request: { ...validRequest, sponsor: merchantAddress },
    calls: validCalls,
    signature: validSignature,
  }),
);
await expectRevert("gas fee above policy", "GasFeeTooHigh", async () => {
  const request = { ...validRequest, gasFeeAmount: feePolicy.maxGasFeeAmount + 1n };
  return simulateSponsored({ request, calls: validCalls, signature: await signRequest(request) });
});
await expectRevert("unsupported fee token", "UnsupportedFeeToken", async () => {
  const request = { ...validRequest, feeToken: sponsorRouterAddress };
  return simulateSponsored({ request, calls: validCalls, signature: await signRequest(request) });
});
await expectRevert("wrong fee receiver", "InvalidFeeReceiver", async () => {
  const wrongFeeReceiver = getAddress(feeReceiver) === getAddress(merchantAddress) ? sponsorAddress : merchantAddress;
  const request = { ...validRequest, feeReceiver: wrongFeeReceiver };
  return simulateSponsored({ request, calls: validCalls, signature: await signRequest(request) });
});

if (feePolicy.maxCalls === 0n) {
  console.log("  ⏭️ too many calls: maxCalls is unlimited");
} else {
  await expectRevert("too many calls", "TooManyCalls", async () => {
    const calls = Array.from({ length: Number(feePolicy.maxCalls + 1n) }, () => validCalls[0]);
    const request = { ...validRequest, callsHash: hashCalls(calls) };
    return simulateSponsored({ request, calls, signature: await signRequest(request) });
  });
}

await expectRevert("wrong nonce", "InvalidNonce", async () => {
  const request = { ...validRequest, nonce: stateBefore.nonce + 1n };
  return simulateSponsored({ request, calls: validCalls, signature: await signRequest(request) });
});
await expectRevert("expired deadline", "SignatureExpired", async () => {
  const request = { ...validRequest, deadline: latestBlock.timestamp - 1n };
  return simulateSponsored({ request, calls: validCalls, signature: await signRequest(request) });
});
await expectRevert("modified calls", "InvalidSignature", () => {
  const calls = [
    {
      ...validCalls[0],
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [merchantAddress, paymentAmount + 1n],
      }),
    },
  ];
  return simulateSponsored({ request: validRequest, calls, signature: validSignature });
});

const stateAfter = await readState();
assertSimulationStateUnchanged(stateBefore, stateAfter);
console.log("  ✅ all simulations left nonce and token balances unchanged");
console.log("BSC Testnet live-contract boundary matrix passed without broadcasting.");
