import { network } from "hardhat";
import {
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  getAddress,
  http,
  parseEventLogs,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { recoverAuthorizationAddress } from "viem/utils";

import { assertCanCoverGas, assertFeeIntent, estimateSponsoredGasLimit } from "./chain-guard.js";
import {
  assertEventCounts,
  assertPaymentInputs,
  delegationTargetFromCode,
  expectedTokenDeltas,
  hashCalls,
  isDryRun,
  isSimulationOnly,
  SPONSORED_NONCE_STORAGE_SLOT,
  sponsoredNonceFromStorage,
  troubleshootingHint,
  type Call,
} from "./sponsored-payment-checks.js";
import {
  assertExpectedAddress,
  envPrefix,
  networkEnv,
  requiredNetworkAddress,
  requiredNetworkAddressList,
  requiredNetworkBigInt,
  requiredNetworkBigIntList,
  requiredNetworkEnv,
  requiredNetworkPositiveSeconds,
  requiredNetworkPrivateKey,
} from "./env-helpers.js";

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

/** Everything that differs between chains. */
export type SponsoredPaymentChain = {
  chainId: number;
  /** Human readable, used in error messages: "Ethereum Mainnet". */
  chainName: string;
  viemChain: Chain;
  /** Native gas currency symbol, used in logs: "ETH", "BNB". */
  nativeSymbol: string;
  /** Token symbol, used in logs: "USDC", "USDT". */
  tokenSymbol: string;
  /**
   * Env keys holding the token addresses this chain will accept.
   * FEE_TOKEN_ADDRESS must resolve to one of them.
   */
  acceptedTokenEnvKeys: readonly string[];
  /**
   * Mainnet guard: pins every accepted token to one known address, so a typo
   * in .env cannot point the run at some other contract. Testnets leave this
   * unset because their tokens are mocks with no canonical address.
   */
  canonicalToken?: Address;
  explorerTxUrl: (hash: Hex) => string;
};

export async function runSponsoredTokenPayment(chainConfig: SponsoredPaymentChain) {
  const dryRun = isDryRun();
  const simulationOnly = isSimulationOnly();

  const connection = await network.create();
  const { viem } = connection;
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  if (chainId !== chainConfig.chainId) {
    throw new Error(`Expected ${chainConfig.chainName} chainId ${chainConfig.chainId}, got ${chainId}`);
  }
  const prefix = envPrefix(connection.networkName);

  const policyRegistryAddress = requiredNetworkAddress(prefix, "POLICY_REGISTRY");
  const accountImplementation = requiredNetworkAddress(prefix, "ACCOUNT_IMPLEMENTATION");
  const sponsorRouterAddress = requiredNetworkAddress(prefix, "SPONSOR_ROUTER");
  const userAddress = requiredNetworkAddress(prefix, "USER_ADDRESS");
  const sponsorAddress = requiredNetworkAddress(prefix, "SPONSOR_ADDRESS");
  const merchantAddress = requiredNetworkAddress(prefix, "MERCHANT_ADDRESS");
  const feeTokenAddress = requiredNetworkAddress(prefix, "FEE_TOKEN_ADDRESS");
  const paymentRecipients =
    networkEnv(prefix, "PAYMENT_RECIPIENTS") === undefined
      ? [merchantAddress]
      : requiredNetworkAddressList(prefix, "PAYMENT_RECIPIENTS");
  const paymentAmounts =
    networkEnv(prefix, "PAYMENT_AMOUNTS") === undefined
      ? [requiredNetworkBigInt(prefix, "PAYMENT_AMOUNT")]
      : requiredNetworkBigIntList(prefix, "PAYMENT_AMOUNTS");
  const gasFeeAmount = requiredNetworkBigInt(prefix, "GAS_FEE_AMOUNT");
  const serviceFeeAmount = requiredNetworkBigInt(prefix, "SERVICE_FEE_AMOUNT");
  const deadlineSeconds = requiredNetworkPositiveSeconds(prefix, "SPONSORED_CALL_DEADLINE_SECONDS");
  const sponsorMinNativeBalance = BigInt(networkEnv(prefix, "RELAYER_MIN_NATIVE_BALANCE") ?? "0");

  const acceptedTokens = chainConfig.acceptedTokenEnvKeys.map((envKey) => {
    const address = requiredNetworkAddress(prefix, envKey);
    if (chainConfig.canonicalToken !== undefined && getAddress(address) !== chainConfig.canonicalToken) {
      throw new Error(
        `${prefix}_${envKey} must be canonical ${chainConfig.chainName} ` +
          `${chainConfig.tokenSymbol} ${chainConfig.canonicalToken}`,
      );
    }
    return getAddress(address);
  });

  if (!acceptedTokens.includes(getAddress(feeTokenAddress))) {
    throw new Error(
      `${prefix}_FEE_TOKEN_ADDRESS must equal one of ` +
        `${chainConfig.acceptedTokenEnvKeys.map((k) => `${prefix}_${k}`).join(", ")}`,
    );
  }
  assertPaymentInputs(paymentRecipients, paymentAmounts);

  const makeWalletClient = (privateKeyName: string) => {
    const account = privateKeyToAccount(requiredNetworkPrivateKey(prefix, privateKeyName));
    const walletClient = createWalletClient({
      account,
      chain: chainConfig.viemChain,
      transport: http(requiredNetworkEnv(prefix, "RPC_URL")),
    });

    return { account, walletClient };
  };

  const { account: userAccount, walletClient: userWalletClient } = makeWalletClient("USER_PRIVATE_KEY");
  const { account: sponsorAccount, walletClient: sponsorWalletClient } = makeWalletClient("SPONSOR_PRIVATE_KEY");

  assertExpectedAddress("USER_ADDRESS", userAccount.address, userAddress);
  assertExpectedAddress("SPONSOR_ADDRESS", sponsorAccount.address, sponsorAddress);

  const requireContractCode = async (name: string, address: Address) => {
    const code = await publicClient.getCode({ address });
    if (code === undefined || code === "0x") {
      throw new Error(`${name} has no contract code on ${chainConfig.chainName}: ${address}`);
    }
  };

  await requireContractCode("POLICY_REGISTRY", policyRegistryAddress);
  await requireContractCode("ACCOUNT_IMPLEMENTATION", accountImplementation);
  await requireContractCode("SPONSOR_ROUTER", sponsorRouterAddress);
  await requireContractCode("FEE_TOKEN_ADDRESS", feeTokenAddress);

  // Production relayers must not carry the Registry owner key. Hardhat's
  // getContractAt otherwise asks the network for a default wallet even for
  // read-only methods, so explicitly bind the Sponsor wallet already created
  // above. Owner-only deployment/ops continue to use POLYGON_PRIVATE_KEY.
  const contractClient = { public: publicClient, wallet: sponsorWalletClient };
  const registry = await viem.getContractAt("SponsorPolicyRegistry", policyRegistryAddress, {
    client: contractClient,
  });
  const account = await viem.getContractAt("Sponsored7702Account", userAddress, {
    client: contractClient,
  });
  const sponsorRouter = await viem.getContractAt("SponsorRouter", sponsorRouterAddress, {
    client: contractClient,
  });

  const feeReceiver = await registry.read.feeReceiver();
  const decimals = await publicClient.readContract({
    address: feeTokenAddress,
    abi: erc20Abi,
    functionName: "decimals",
  });

  const totalFeeAmount = gasFeeAmount + serviceFeeAmount;
  assertFeeIntent(totalFeeAmount);
  const totalPaymentAmount = paymentAmounts.reduce((sum, amount) => sum + amount, 0n);
  const totalRequiredAmount = totalFeeAmount + totalPaymentAmount;
  const trackedDeltas = expectedTokenDeltas(paymentRecipients, paymentAmounts, feeReceiver, totalFeeAmount);

  const readTokenBalance = (owner: Address) =>
    publicClient.readContract({
      address: feeTokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    });

  const userBalanceBefore = await readTokenBalance(userAddress);
  const trackedBalancesBefore = new Map<Address, bigint>();
  for (const address of trackedDeltas.keys()) {
    trackedBalancesBefore.set(address, await readTokenBalance(address));
  }
  const sponsorNativeBalanceBefore = await publicClient.getBalance({ address: sponsorAddress });
  const userNativeBalanceBefore = await publicClient.getBalance({ address: userAddress });

  const sponsorAllowed = await registry.read.isSponsor([sponsorAddress]);
  const feeTokenSupported = await registry.read.isSupportedFeeToken([feeTokenAddress]);
  const registryPaused = await registry.read.paused();

  if (!sponsorAllowed) {
    throw new Error(`SPONSOR_ADDRESS is not allowed in registry: ${sponsorAddress}`);
  }
  if (!feeTokenSupported) {
    throw new Error(`FEE_TOKEN_ADDRESS is not supported in registry: ${feeTokenAddress}`);
  }
  if (registryPaused) {
    throw new Error("SponsorPolicyRegistry is paused; sponsored execution is disabled");
  }
  if (userBalanceBefore < totalRequiredAmount) {
    throw new Error(
      `USER_ADDRESS ${chainConfig.tokenSymbol} balance is too low: ` +
        `balance=${userBalanceBefore}, required=${totalRequiredAmount}`,
    );
  }
  // No separate zero check: assertCanCoverGas below already rejects a zero
  // balance, and it reports how much is actually needed. Failing early on
  // zero only hid that number from whoever has to fund the wallet.
  if (sponsorNativeBalanceBefore < sponsorMinNativeBalance) {
    throw new Error(
      `SPONSOR_ADDRESS ${chainConfig.nativeSymbol} balance is too low: ` +
        `balance=${sponsorNativeBalanceBefore}, required=${sponsorMinNativeBalance}`,
    );
  }

  const gasPrice = await publicClient.getGasPrice();
  const estimatedGasLimit = estimateSponsoredGasLimit(paymentRecipients.length);
  assertCanCoverGas({
    label: "SPONSOR_ADDRESS",
    address: sponsorAddress,
    balance: sponsorNativeBalanceBefore,
    gasPrice,
    gasLimit: estimatedGasLimit,
    nativeSymbol: chainConfig.nativeSymbol,
  });

  const currentCode = await publicClient.getCode({ address: userAddress });
  const currentDelegationTarget = delegationTargetFromCode(currentCode);
  const sponsoredNonce = sponsoredNonceFromStorage(
    await publicClient.getStorageAt({
      address: userAddress,
      slot: SPONSORED_NONCE_STORAGE_SLOT,
    }),
  );
  const latestBlock = await publicClient.getBlock();
  const deadline = latestBlock.timestamp + deadlineSeconds;

  const calls: Call[] = paymentRecipients.map((recipient, index) => ({
    target: feeTokenAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, paymentAmounts[index]],
    }),
  }));

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

  console.log(`${chainConfig.chainName} sponsored payment preflight:`);
  console.log(`  chainId: ${chainId}`);
  console.log(`  user: ${userAddress}`);
  console.log(`  sponsor: ${sponsorAddress}`);
  console.log(`  sponsor allowed: ${sponsorAllowed}`);
  console.log(`  registry paused: ${registryPaused}`);
  console.log(`  fee token supported: ${feeTokenSupported}`);
  console.log(`  token: ${feeTokenAddress} (${chainConfig.tokenSymbol})`);
  console.log(`  feeReceiver: ${feeReceiver}`);
  console.log(`  account nonce: ${sponsoredNonce}`);
  console.log(`  current delegation: ${currentDelegationTarget ?? "none / non-7702 code"}`);
  console.log(`  target delegation: ${accountImplementation}`);
  console.log(`  deadline: ${deadline} (block timestamp ${latestBlock.timestamp})`);
  console.log(`  calls: ${calls.length}`);
  console.log(`  user balance: ${formatUnits(userBalanceBefore, decimals)}`);
  console.log(`  required: ${formatUnits(totalRequiredAmount, decimals)}`);
  console.log(`  payments: ${formatUnits(totalPaymentAmount, decimals)}`);
  console.log(`  fees: ${formatUnits(totalFeeAmount, decimals)}`);
  console.log(`  sponsor ${chainConfig.nativeSymbol}: ${formatEther(sponsorNativeBalanceBefore)}`);
  console.log(`  sponsor minimum ${chainConfig.nativeSymbol}: ${formatEther(sponsorMinNativeBalance)}`);
  console.log(
    `  estimated gas cost: ${formatEther(gasPrice * estimatedGasLimit)} ` +
      `(${estimatedGasLimit} gas at ${gasPrice} wei)`,
  );
  console.log("\nExpected token deltas:");
  console.log(`  ${userAddress}: -${formatUnits(totalRequiredAmount, decimals)}`);
  for (const [address, delta] of trackedDeltas) {
    console.log(`  ${address}: +${formatUnits(delta, decimals)}`);
  }

  if (dryRun) {
    console.log("\nDry run enabled; not signing and not sending a transaction.");
    return;
  }

  console.log(`\nSigning ${chainConfig.chainName} SponsoredCall with user...`);
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

  const authorizationSigner = await recoverAuthorizationAddress({ authorization });
  assertExpectedAddress("authorization signer", authorizationSigner, userAddress);

  const routerCalldata = encodeFunctionData({
    abi: sponsorRouter.abi,
    functionName: "executeSponsored",
    args: [request, calls, userSignature],
  });
  const accountImplementationCode = await publicClient.getCode({ address: accountImplementation });
  if (accountImplementationCode === undefined || accountImplementationCode === "0x") {
    throw new Error(`ACCOUNT_IMPLEMENTATION has no contract code: ${accountImplementation}`);
  }

  // Polygon RPC currently estimates against the account's old delegation when
  // an EIP-7702 authorization replaces it. Simulate the exact signed call with
  // our implementation code installed at the user address, then supply the
  // guarded gas limit explicitly so sendTransaction does not repeat that
  // incorrect node-side estimate.
  console.log("Simulating signed SponsoredCall with target account implementation...");
  await publicClient.call({
    account: sponsorAddress,
    to: sponsorRouterAddress,
    data: routerCalldata,
    gas: estimatedGasLimit,
    stateOverride: [{ address: userAddress, code: accountImplementationCode }],
  });
  console.log("Signed simulation: success");

  if (simulationOnly) {
    console.log("Simulation-only mode enabled; not sending a transaction.");
    return;
  }

  console.log("Sending executeSponsored through SponsorRouter from sponsor...");
  const hash = await sponsorWalletClient.sendTransaction({
    account: sponsorAccount,
    to: sponsorRouterAddress,
    data: routerCalldata,
    authorizationList: [authorization],
    gas: estimatedGasLimit,
  });
  console.log(`tx: ${hash}`);
  console.log(chainConfig.explorerTxUrl(hash));

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const tx = await publicClient.getTransaction({ hash });
  console.log(`status: ${receipt.status}`);
  console.log(`gasUsed: ${receipt.gasUsed}`);

  assertExpectedAddress("tx.from", tx.from, sponsorAddress);
  if (tx.to === null) {
    throw new Error("tx.to is null, expected SponsorRouter address");
  }
  assertExpectedAddress("tx.to", tx.to, sponsorRouterAddress);
  if (tx.type !== "eip7702") {
    throw new Error(`Unexpected transaction type: got=${tx.type}, expected=eip7702`);
  }
  if (receipt.status !== "success") {
    throw new Error(`Sponsored transaction reverted: ${hash}`);
  }

  const forwardedLogs = parseEventLogs({
    abi: sponsorRouter.abi,
    eventName: "SponsoredCallForwarded",
    logs: receipt.logs,
  }).filter((log) => getAddress(log.address) === getAddress(sponsorRouterAddress));
  const feePaidLogs = parseEventLogs({
    abi: account.abi,
    eventName: "FeePaid",
    logs: receipt.logs,
  }).filter((log) => getAddress(log.address) === getAddress(userAddress));
  const transferLogs = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: receipt.logs,
  }).filter((log) => getAddress(log.address) === getAddress(feeTokenAddress));

  console.log("\nEvent summary:");
  console.log(`  SponsoredCallForwarded: ${forwardedLogs.length}`);
  console.log(`  FeePaid: ${feePaidLogs.length}`);
  console.log(`  ${chainConfig.tokenSymbol} Transfer: ${transferLogs.length}`);

  assertEventCounts({
    forwarded: forwardedLogs.length,
    feePaid: feePaidLogs.length,
    transfers: transferLogs.length,
    callCount: calls.length,
    totalFeeAmount,
  });

  const userBalanceAfter = await readTokenBalance(userAddress);
  const sponsorNativeBalanceAfter = await publicClient.getBalance({ address: sponsorAddress });
  const userNativeBalanceAfter = await publicClient.getBalance({ address: userAddress });
  const accountNonceAfter = sponsoredNonceFromStorage(
    await publicClient.getStorageAt({
      address: userAddress,
      slot: SPONSORED_NONCE_STORAGE_SLOT,
    }),
  );
  const userDelta = userBalanceBefore - userBalanceAfter;

  if (accountNonceAfter !== sponsoredNonce + 1n) {
    throw new Error(`Unexpected account nonce: got=${accountNonceAfter}, expected=${sponsoredNonce + 1n}`);
  }
  if (userDelta !== totalRequiredAmount) {
    throw new Error(
      `Unexpected user ${chainConfig.tokenSymbol} delta: got=${userDelta}, expected=${totalRequiredAmount}`,
    );
  }
  if (userNativeBalanceAfter !== userNativeBalanceBefore) {
    throw new Error(
      `Unexpected user ${chainConfig.nativeSymbol} delta: ` +
        `got=${userNativeBalanceAfter - userNativeBalanceBefore}, expected=0`,
    );
  }

  console.log("\nFinal state:");
  console.log(`  account nonce: ${accountNonceAfter}`);
  console.log(`  user ${chainConfig.tokenSymbol} delta: -${formatUnits(userDelta, decimals)}`);
  console.log(`  user ${chainConfig.nativeSymbol} gas delta: 0`);
  console.log(
    `  sponsor ${chainConfig.nativeSymbol} gas delta: ` +
      `${formatEther(sponsorNativeBalanceBefore - sponsorNativeBalanceAfter)}`,
  );

  for (const [address, expectedDelta] of trackedDeltas) {
    const before = trackedBalancesBefore.get(address) ?? 0n;
    const actualDelta = (await readTokenBalance(address)) - before;
    if (actualDelta !== expectedDelta) {
      throw new Error(
        `Unexpected ${chainConfig.tokenSymbol} delta for ${address}: got=${actualDelta}, expected=${expectedDelta}`,
      );
    }
    console.log(`  ${address} delta: +${formatUnits(actualDelta, decimals)}`);
  }
}

/** Shared entry point: runs the payment and turns failures into a clean exit. */
export async function main(chainConfig: SponsoredPaymentChain) {
  try {
    await runSponsoredTokenPayment(chainConfig);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);

    const hint = troubleshootingHint(message);
    if (hint !== undefined) {
      console.error(`\nHint: ${hint}`);
    }

    process.exitCode = 1;
  }
}
