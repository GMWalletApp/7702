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

import { assertSupportedToken } from "./chains.js";
import type {
  Amountish,
  AuthorizationLike,
  BuildSponsoredCallRequestInput,
  BuildTokenTransferCallInput,
  EncodeExecuteSponsoredInput,
  JsonSponsoredCall,
  JsonSponsoredCallRequest,
  PrepareSponsoredPayloadInput,
  Sign7702AuthorizationInput,
  SignSponsoredCallInput,
  SponsoredCall,
  SponsoredCallRequest,
  SponsoredPayload,
  SponsoredWalletAccount,
  SponsoredWalletClient,
} from "./types.js";

export {
  SUPPORTED_CHAIN_TOKENS,
  assertSupportedToken,
  getSupportedTokenConfig,
  type StableTokenSymbol,
  type SupportedChainKey,
  type SupportedChainToken,
  type SupportedTokenConfig,
} from "./chains.js";

export type {
  Amountish,
  AuthorizationLike,
  BuildSponsoredCallRequestInput,
  BuildTokenTransferCallInput,
  EncodeExecuteSponsoredInput,
  JsonSponsoredCall,
  JsonSponsoredCallRequest,
  PrepareSponsoredPayloadInput,
  Sign7702AuthorizationInput,
  SignSponsoredCallInput,
  SponsoredCall,
  SponsoredCallRequest,
  SponsoredPayload,
  SponsoredPayloadContext,
  SponsoredWalletAccount,
  SponsoredWalletClient,
} from "./types.js";

export const SPONSORED_CALL_DOMAIN = {
  name: "Sponsored7702Account",
  version: "1",
} as const;

export const SPONSORED_CALL_TYPES = {
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

export const SPONSOR_ROUTER_ABI = [
  {
    type: "function",
    name: "executeSponsored",
    stateMutability: "payable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
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
      },
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
      { name: "userSignature", type: "bytes" },
    ],
    outputs: [{ name: "returnData", type: "bytes[]" }],
  },
] as const;

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const CALL_TYPEHASH = keccak256(
  new TextEncoder().encode("Call(address target,uint256 value,bytes32 dataHash)"),
);

function toAmount(value: Amountish, fieldName: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${fieldName} must be a safe integer when passed as a number`);
    }

    return BigInt(value);
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${fieldName} must be an unsigned integer string`);
  }

  return BigInt(value);
}

function assertNonNegativeAmount(value: bigint, fieldName: string) {
  if (value < 0n) {
    throw new Error(`${fieldName} must be greater than or equal to 0`);
  }
}

function assertPositiveAmount(value: bigint, fieldName: string) {
  if (value <= 0n) {
    throw new Error(`${fieldName} must be greater than 0`);
  }
}

function resolveWalletAccount(
  walletClient: SponsoredWalletClient,
  account?: SponsoredWalletAccount,
): SponsoredWalletAccount {
  const resolvedAccount = account ?? walletClient.account;
  if (resolvedAccount === undefined) {
    throw new Error("walletClient account is required for signing");
  }

  return resolvedAccount;
}

function getWalletAccountAddress(account: SponsoredWalletAccount): Address {
  if (typeof account === "string") {
    return getAddress(account);
  }

  return getAddress(account.address);
}

function serializeCall(call: SponsoredCall): JsonSponsoredCall {
  return {
    target: getAddress(call.target),
    value: call.value.toString(),
    data: call.data,
  };
}

function serializeRequest(request: SponsoredCallRequest): JsonSponsoredCallRequest {
  return {
    account: getAddress(request.account),
    nonce: request.nonce.toString(),
    deadline: request.deadline.toString(),
    sponsor: getAddress(request.sponsor),
    feeToken: getAddress(request.feeToken),
    gasFeeAmount: request.gasFeeAmount.toString(),
    serviceFeeAmount: request.serviceFeeAmount.toString(),
    feeReceiver: getAddress(request.feeReceiver),
    callsHash: request.callsHash,
  };
}

function tokenNeedsCanary(config: ReturnType<typeof assertSupportedToken>): boolean {
  return (config as { needsCanary?: boolean }).needsCanary === true;
}

export function buildTokenTransferCall(input: BuildTokenTransferCallInput): SponsoredCall {
  const amount = toAmount(input.amount, "amount");
  assertPositiveAmount(amount, "amount");

  return {
    target: getAddress(input.tokenAddress),
    value: 0n,
    data: encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [getAddress(input.to), amount],
    }),
  };
}

export function hashCall(call: SponsoredCall): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32,address,uint256,bytes32"), [
      CALL_TYPEHASH,
      getAddress(call.target),
      call.value,
      keccak256(call.data),
    ]),
  );
}

export function hashCalls(calls: readonly SponsoredCall[]): Hex {
  return keccak256(calls.length === 0 ? "0x" : concat(calls.map(hashCall)));
}

export function buildSponsoredCallRequest(input: BuildSponsoredCallRequestInput): SponsoredCallRequest {
  const nonce = toAmount(input.nonce, "nonce");
  const deadline = toAmount(input.deadline, "deadline");
  const gasFeeAmount = toAmount(input.gasFeeAmount, "gasFeeAmount");
  const serviceFeeAmount = toAmount(input.serviceFeeAmount, "serviceFeeAmount");

  assertNonNegativeAmount(nonce, "nonce");
  assertNonNegativeAmount(deadline, "deadline");
  assertNonNegativeAmount(gasFeeAmount, "gasFeeAmount");
  assertNonNegativeAmount(serviceFeeAmount, "serviceFeeAmount");

  return {
    account: getAddress(input.account),
    nonce,
    deadline,
    sponsor: getAddress(input.sponsor),
    feeToken: getAddress(input.feeToken),
    gasFeeAmount,
    serviceFeeAmount,
    feeReceiver: getAddress(input.feeReceiver),
    callsHash: input.callsHash,
  };
}

export async function signSponsoredCall(input: SignSponsoredCallInput): Promise<Hex> {
  const signingAccount = resolveWalletAccount(input.walletClient, input.account);

  return input.walletClient.signTypedData({
    account: signingAccount,
    domain: {
      ...SPONSORED_CALL_DOMAIN,
      chainId: input.chainId,
      verifyingContract: getAddress(input.verifyingContract),
    },
    types: SPONSORED_CALL_TYPES,
    primaryType: "SponsoredCall",
    message: input.request,
  });
}

export async function sign7702Authorization(input: Sign7702AuthorizationInput): Promise<AuthorizationLike> {
  const signingAccount = resolveWalletAccount(input.walletClient, input.account);
  const parameters: Record<string, unknown> = {
    account: signingAccount,
    contractAddress: getAddress(input.accountImplementation),
    executor: getAddress(input.sponsorAddress),
  };

  if (input.chainId !== undefined) {
    parameters.chainId = input.chainId;
  }
  if (input.nonce !== undefined) {
    parameters.nonce = input.nonce;
  }

  return input.walletClient.signAuthorization(parameters);
}

export function encodeExecuteSponsored(input: EncodeExecuteSponsoredInput): Hex {
  return encodeFunctionData({
    abi: SPONSOR_ROUTER_ABI,
    functionName: "executeSponsored",
    args: [input.request, input.calls, input.userSignature],
  });
}

export async function prepareSponsoredPayload(input: PrepareSponsoredPayloadInput): Promise<SponsoredPayload> {
  const config = assertSupportedToken(input.chainId, input.tokenSymbol);
  const userAddress = getAddress(input.userAddress);
  const sponsorAddress = getAddress(input.sponsorAddress);
  const merchantAddress = getAddress(input.merchantAddress);
  const feeReceiver = getAddress(input.feeReceiver);
  const sponsorRouter = getAddress(input.sponsorRouter);
  const accountImplementation = getAddress(input.accountImplementation);
  const paymentAmount = toAmount(input.paymentAmount, "paymentAmount");
  const gasFeeAmount = toAmount(input.gasFeeAmount, "gasFeeAmount");
  const serviceFeeAmount = toAmount(input.serviceFeeAmount, "serviceFeeAmount");

  assertPositiveAmount(paymentAmount, "paymentAmount");
  assertNonNegativeAmount(gasFeeAmount, "gasFeeAmount");
  assertNonNegativeAmount(serviceFeeAmount, "serviceFeeAmount");

  const signingAccount = input.walletAccount ?? input.walletClient.account ?? userAddress;
  const signingAddress = getWalletAccountAddress(signingAccount);
  if (signingAddress !== userAddress) {
    throw new Error(`walletClient account ${signingAddress} does not match userAddress ${userAddress}`);
  }

  const calls = [
    buildTokenTransferCall({
      tokenAddress: config.tokenAddress,
      to: merchantAddress,
      amount: paymentAmount,
    }),
  ];
  const callsHash = hashCalls(calls);
  const request = buildSponsoredCallRequest({
    account: userAddress,
    nonce: input.nonce,
    deadline: input.deadline,
    sponsor: sponsorAddress,
    feeToken: config.tokenAddress,
    gasFeeAmount,
    serviceFeeAmount,
    feeReceiver,
    callsHash,
  });
  const userSignature = await signSponsoredCall({
    walletClient: input.walletClient,
    account: signingAccount,
    chainId: input.chainId,
    verifyingContract: userAddress,
    request,
  });
  const authorization = await sign7702Authorization({
    walletClient: input.walletClient,
    account: signingAccount,
    accountImplementation,
    sponsorAddress,
    chainId: input.authorizationChainId,
    nonce: input.authorizationNonce,
  });
  const data = encodeExecuteSponsored({
    request,
    calls,
    userSignature,
  });
  const totalFeeAmount = gasFeeAmount + serviceFeeAmount;
  const totalRequiredAmount = paymentAmount + totalFeeAmount;

  return {
    chainId: config.chainId,
    chainKey: config.chainKey,
    to: sponsorRouter,
    value: "0",
    data,
    request: serializeRequest(request),
    calls: calls.map(serializeCall),
    userSignature,
    authorizationList: [authorization],
    context: {
      user: userAddress,
      sponsor: sponsorAddress,
      merchant: merchantAddress,
      feeToken: config.tokenAddress,
      feeTokenSymbol: config.tokenSymbol,
      feeTokenDecimals: config.decimals,
      feeReceiver,
      paymentAmount: paymentAmount.toString(),
      gasFeeAmount: gasFeeAmount.toString(),
      serviceFeeAmount: serviceFeeAmount.toString(),
      totalFeeAmount: totalFeeAmount.toString(),
      totalRequiredAmount: totalRequiredAmount.toString(),
      verified: config.verified,
      needsCanary: tokenNeedsCanary(config),
    },
  };
}

export function stringifySponsoredPayload(payload: unknown): string {
  return JSON.stringify(
    payload,
    (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );
}
