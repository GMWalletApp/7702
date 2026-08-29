import type { Account, Address, Hex } from "viem";

import type { StableTokenSymbol, SupportedChainKey } from "./chains.js";

export type Amountish = bigint | number | string;

export type SponsoredWalletAccount = Account | Address;

export type AuthorizationLike = Record<string, unknown>;

export type SponsoredWalletClient = {
  account?: SponsoredWalletAccount;
  signTypedData(parameters: Record<string, unknown>): Promise<Hex>;
  signAuthorization(parameters: Record<string, unknown>): Promise<AuthorizationLike>;
};

export type SponsoredCall = {
  target: Address;
  value: bigint;
  data: Hex;
};

export type JsonSponsoredCall = {
  target: Address;
  value: string;
  data: Hex;
};

export type SponsoredCallRequest = {
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

export type JsonSponsoredCallRequest = {
  account: Address;
  nonce: string;
  deadline: string;
  sponsor: Address;
  feeToken: Address;
  gasFeeAmount: string;
  serviceFeeAmount: string;
  feeReceiver: Address;
  callsHash: Hex;
};

export type BuildTokenTransferCallInput = {
  tokenAddress: Address;
  to: Address;
  amount: Amountish;
};

export type BuildSponsoredCallRequestInput = {
  account: Address;
  nonce: Amountish;
  deadline: Amountish;
  sponsor: Address;
  feeToken: Address;
  gasFeeAmount: Amountish;
  serviceFeeAmount: Amountish;
  feeReceiver: Address;
  callsHash: Hex;
};

export type SignSponsoredCallInput = {
  walletClient: SponsoredWalletClient;
  account?: SponsoredWalletAccount;
  chainId: number;
  verifyingContract: Address;
  request: SponsoredCallRequest;
};

export type Sign7702AuthorizationInput = {
  walletClient: SponsoredWalletClient;
  account?: SponsoredWalletAccount;
  accountImplementation: Address;
  sponsorAddress: Address;
  chainId?: number;
  nonce?: number;
};

export type EncodeExecuteSponsoredInput = {
  request: SponsoredCallRequest;
  calls: readonly SponsoredCall[];
  userSignature: Hex;
};

export type PrepareSponsoredPayloadInput = {
  chainId: number;
  tokenSymbol: StableTokenSymbol;
  userAddress: Address;
  sponsorAddress: Address;
  merchantAddress: Address;
  feeReceiver: Address;
  sponsorRouter: Address;
  accountImplementation: Address;
  paymentAmount: Amountish;
  gasFeeAmount: Amountish;
  serviceFeeAmount: Amountish;
  nonce: Amountish;
  deadline: Amountish;
  walletClient: SponsoredWalletClient;
  walletAccount?: SponsoredWalletAccount;
  authorizationChainId?: number;
  authorizationNonce?: number;
};

export type SponsoredPayloadContext = {
  user: Address;
  sponsor: Address;
  merchant: Address;
  feeToken: Address;
  feeTokenSymbol: StableTokenSymbol;
  feeTokenDecimals: number;
  feeReceiver: Address;
  paymentAmount: string;
  gasFeeAmount: string;
  serviceFeeAmount: string;
  totalFeeAmount: string;
  totalRequiredAmount: string;
  verified: boolean;
  needsCanary: boolean;
};

export type SponsoredPayload = {
  chainId: number;
  chainKey: SupportedChainKey;
  to: Address;
  value: "0";
  data: Hex;
  request: JsonSponsoredCallRequest;
  calls: JsonSponsoredCall[];
  userSignature: Hex;
  authorizationList: AuthorizationLike[];
  context: SponsoredPayloadContext;
};
