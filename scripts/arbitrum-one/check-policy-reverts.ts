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
import { arbitrum } from "viem/chains";

import {
  assertExpectedAddress,
  envPrefix,
  requiredNetworkAddress,
  requiredNetworkBigInt,
  requiredNetworkEnv,
  requiredNetworkPositiveSeconds,
  requiredNetworkPrivateKey,
} from "../env-helpers.js";

const ARBITRUM_ONE_CHAIN_ID = 42161;
const ARBITRUM_ONE_NATIVE_USDC = getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
const CALL_TYPEHASH = keccak256(new TextEncoder().encode("Call(address target,uint256 value,bytes32 dataHash)"));

const sponsorRouterSimulationAbi = parseAbi([
  "function executeSponsored((address account,uint256 nonce,uint256 deadline,address sponsor,address feeToken,uint256 gasFeeAmount,uint256 serviceFeeAmount,address feeReceiver,bytes32 callsHash) request,(address target,uint256 value,bytes data)[] calls,bytes userSignature) payable returns (bytes[] returnData)",
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
  "error PolicyPaused()",
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

function findErrorName(error: unknown): string | undefined {
  const object = errorObject(error);
  if (object === undefined) {
    return undefined;
  }

  const data = errorObject(object.data);
  if (typeof data?.errorName === "string") {
    return data.errorName;
  }
  if (typeof object.name === "string" && object.name.endsWith("Error")) {
    return object.name;
  }

  return findErrorName(object.cause);
}

function errorText(error: unknown): string {
  const object = errorObject(error);
  if (object === undefined) {
    return String(error);
  }

  const parts = [
    findErrorName(error),
    typeof object.shortMessage === "string" ? object.shortMessage : undefined,
    typeof object.details === "string" ? object.details : undefined,
    typeof object.message === "string" ? object.message : undefined,
    object.cause === undefined ? undefined : errorText(object.cause),
  ];

  return parts.filter((part): part is string => part !== undefined).join("\n");
}

async function requireContractCode(name: string, address: Address) {
  const code = await publicClient.getCode({ address });
  if (code === undefined || code === "0x") {
    throw new Error(`${name} has no contract code on Arbitrum One: ${address}`);
  }
}

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
}) {
  return publicClient.simulateContract({
    account: params.sender ?? sponsorAddress,
    address: sponsorRouterAddress,
    abi: sponsorRouterSimulationAbi,
    functionName: "executeSponsored",
    args: [params.request, params.calls, params.signature],
    ...(authorizationList === undefined ? {} : { authorizationList }),
  });
}

async function waitForTx(hash: Hex) {
  console.log(`  tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error(`Transaction failed: ${hash}`);
  }

  return receipt;
}

async function expectRevert(name: string, expectedError: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    const text = errorText(error);
    if (!text.includes(expectedError)) {
      throw new Error(`${name}: expected ${expectedError}, got:\n${text}`);
    }
    console.log(`  ok ${name}: ${expectedError}`);
    return;
  }

  throw new Error(`${name}: expected ${expectedError}, but simulation succeeded`);
}

const connection = await network.create();
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
if (chainId !== ARBITRUM_ONE_CHAIN_ID) {
  throw new Error(`Expected Arbitrum One chainId ${ARBITRUM_ONE_CHAIN_ID}, got ${chainId}`);
}
const prefix = envPrefix(connection.networkName);

const policyRegistryAddress = requiredNetworkAddress(prefix, "POLICY_REGISTRY");
const accountImplementation = requiredNetworkAddress(prefix, "ACCOUNT_IMPLEMENTATION");
const sponsorRouterAddress = requiredNetworkAddress(prefix, "SPONSOR_ROUTER");
const userAddress = requiredNetworkAddress(prefix, "USER_ADDRESS");
const sponsorAddress = requiredNetworkAddress(prefix, "SPONSOR_ADDRESS");
const merchantAddress = requiredNetworkAddress(prefix, "MERCHANT_ADDRESS");
const feeTokenAddress = requiredNetworkAddress(prefix, "FEE_TOKEN_ADDRESS");
const usdcAddress = requiredNetworkAddress(prefix, "USDC_TOKEN_ADDRESS");
const paymentAmount = requiredNetworkBigInt(prefix, "PAYMENT_AMOUNT");
const gasFeeAmount = requiredNetworkBigInt(prefix, "GAS_FEE_AMOUNT");
const serviceFeeAmount = requiredNetworkBigInt(prefix, "SERVICE_FEE_AMOUNT");
const deadlineSeconds = requiredNetworkPositiveSeconds(prefix, "SPONSORED_CALL_DEADLINE_SECONDS");

if (getAddress(usdcAddress) !== ARBITRUM_ONE_NATIVE_USDC) {
  throw new Error(`USDC_TOKEN_ADDRESS must be Arbitrum native USDC ${ARBITRUM_ONE_NATIVE_USDC}`);
}
if (getAddress(feeTokenAddress) !== ARBITRUM_ONE_NATIVE_USDC) {
  throw new Error(`FEE_TOKEN_ADDRESS must be Arbitrum native USDC ${ARBITRUM_ONE_NATIVE_USDC}`);
}

const userAccount = privateKeyToAccount(requiredNetworkPrivateKey(prefix, "USER_PRIVATE_KEY"));
const userWalletClient = createWalletClient({
  account: userAccount,
  chain: arbitrum,
  transport: http(requiredNetworkEnv(prefix, "RPC_URL")),
});

assertExpectedAddress("USER_ADDRESS", userAccount.address, userAddress);

await requireContractCode("POLICY_REGISTRY", policyRegistryAddress);
await requireContractCode("ACCOUNT_IMPLEMENTATION", accountImplementation);
await requireContractCode("SPONSOR_ROUTER", sponsorRouterAddress);
await requireContractCode("USDC_TOKEN_ADDRESS", usdcAddress);

const registry = await viem.getContractAt("SponsorPolicyRegistry", policyRegistryAddress);
const account = await viem.getContractAt("Sponsored7702Account", userAddress);
const feeReceiver = await registry.read.feeReceiver();
const feePolicy = await registry.read.feePolicy();
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

const latestBlock = await publicClient.getBlock();
const currentNonce = delegationTarget === undefined ? 0n : await account.read.getNonce();
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
  nonce: currentNonce,
  deadline: latestBlock.timestamp + deadlineSeconds,
  sponsor: sponsorAddress,
  feeToken: feeTokenAddress,
  gasFeeAmount,
  serviceFeeAmount,
  feeReceiver,
  callsHash: hashCalls(validCalls),
};
const validSignature = await signRequest(validRequest);

console.log("Simulating valid Arbitrum One sponsored request...");
await simulateSponsored({
  request: validRequest,
  calls: validCalls,
  signature: validSignature,
});
console.log("  ok valid sponsored request simulation");

console.log("\nChecking expected policy/auth reverts with eth_call simulation...");

await expectRevert("non-sponsor sender", "NotSponsor", async () =>
  simulateSponsored({
    request: { ...validRequest, sponsor: merchantAddress },
    calls: validCalls,
    signature: validSignature,
    sender: merchantAddress,
  }),
);

await expectRevert("mismatched sponsor", "InvalidSponsor", async () =>
  simulateSponsored({
    request: { ...validRequest, sponsor: merchantAddress },
    calls: validCalls,
    signature: validSignature,
  }),
);

const merchantCode = await publicClient.getCode({ address: merchantAddress });
if (merchantCode !== undefined && merchantCode !== "0x") {
  console.log(
    "  skip account not delegated: MERCHANT_ADDRESS has code. Use a fresh undelegated user address to test AccountNotDelegated.",
  );
} else {
  await expectRevert("account not delegated", "AccountNotDelegated", async () =>
    simulateSponsored({
      request: { ...validRequest, account: merchantAddress },
      calls: validCalls,
      signature: validSignature,
    }),
  );
}

await expectRevert("gas fee too high", "GasFeeTooHigh", async () => {
  const request = {
    ...validRequest,
    gasFeeAmount: feePolicy.maxGasFeeAmount + 1n,
  };
  return simulateSponsored({
    request,
    calls: validCalls,
    signature: await signRequest(request),
  });
});

await expectRevert("unsupported fee token", "UnsupportedFeeToken", async () => {
  const request = {
    ...validRequest,
    feeToken: sponsorRouterAddress,
  };
  return simulateSponsored({
    request,
    calls: validCalls,
    signature: await signRequest(request),
  });
});

async function checkPolicyPausedWithRealPause() {
  const wasPaused = await registry.read.paused();

  if (wasPaused) {
    console.log("  skip policy paused: registry is already paused before test");
    return;
  }

  console.log("  pausing registry for real PolicyPaused test...");
  const pauseHash = await registry.write.pause();
  await waitForTx(pauseHash);

  try {
    if (!(await registry.read.paused())) {
      throw new Error("registry.pause() transaction succeeded, but paused() is still false");
    }

    await expectRevert("policy paused", "PolicyPaused", async () =>
      simulateSponsored({
        request: validRequest,
        calls: validCalls,
        signature: validSignature,
      }),
    );
  } finally {
    console.log("  unpausing registry after PolicyPaused test...");
    const unpauseHash = await registry.write.unpause();
    await waitForTx(unpauseHash);

    if (await registry.read.paused()) {
      throw new Error("registry.unpause() transaction succeeded, but paused() is still true");
    }
  }
}

await checkPolicyPausedWithRealPause();

await expectRevert("wrong fee receiver", "InvalidFeeReceiver", async () => {
  const wrongFeeReceiver = getAddress(feeReceiver) === getAddress(merchantAddress) ? sponsorAddress : merchantAddress;
  const request = {
    ...validRequest,
    feeReceiver: wrongFeeReceiver,
  };
  return simulateSponsored({
    request,
    calls: validCalls,
    signature: await signRequest(request),
  });
});

if (feePolicy.maxCalls === 0n) {
  console.log("  skip too many calls: maxCalls is 0/unlimited");
} else {
  await expectRevert("too many calls", "TooManyCalls", async () => {
    const calls = Array.from({ length: Number(feePolicy.maxCalls + 1n) }, () => validCalls[0]);
    const request = {
      ...validRequest,
      callsHash: hashCalls(calls),
    };
    return simulateSponsored({
      request,
      calls,
      signature: await signRequest(request),
    });
  });
}

await expectRevert("invalid nonce", "InvalidNonce", async () => {
  const request = {
    ...validRequest,
    nonce: currentNonce + 1n,
  };
  return simulateSponsored({
    request,
    calls: validCalls,
    signature: await signRequest(request),
  });
});

await expectRevert("expired deadline", "SignatureExpired", async () => {
  const request = {
    ...validRequest,
    deadline: latestBlock.timestamp - 1n,
  };
  return simulateSponsored({
    request,
    calls: validCalls,
    signature: await signRequest(request),
  });
});

await expectRevert("invalid calls hash", "InvalidSignature", async () => {
  const modifiedCalls = [
    {
      ...validCalls[0],
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [merchantAddress, paymentAmount + 1n],
      }),
    },
  ];
  return simulateSponsored({
    request: validRequest,
    calls: modifiedCalls,
    signature: validSignature,
  });
});

console.log(
  "\nArbitrum One policy revert checks passed. Failure cases were simulated; " +
    "PolicyPaused used real pause/unpause admin transactions.",
);
