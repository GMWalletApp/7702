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
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";

import {
  assertExpectedAddress,
  envPrefix,
  networkEnv,
  requiredNetworkAddress,
  requiredNetworkAddressList,
  requiredNetworkBigInt,
  requiredNetworkBigIntList,
  requiredNetworkEnv,
  requiredNetworkPrivateKey,
} from "../env-helpers.js";
import { isDryRun } from "../sponsored-payment-checks.js";

const ARBITRUM_ONE_CHAIN_ID = 42161;
const ARBITRUM_ONE_NATIVE_USDC = getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");

type Call = {
  target: Address;
  value: bigint;
  data: Hex;
};

function addDelta(totals: Map<Address, bigint>, address: Address, amount: bigint) {
  totals.set(address, (totals.get(address) ?? 0n) + amount);
}

function getDelegationTarget(code: Hex | undefined): Address | undefined {
  if (code === undefined || code === "0x") {
    return undefined;
  }

  const normalizedCode = code.toLowerCase();
  if (normalizedCode.startsWith("0xef0100") && normalizedCode.length === 48) {
    return getAddress(`0x${normalizedCode.slice(8)}`);
  }

  throw new Error(`USER_ADDRESS has unexpected code. Expected empty code or EIP-7702 delegation, got: ${code}`);
}

async function requireContractCode(
  publicClient: Awaited<ReturnType<Awaited<ReturnType<typeof network.create>>["viem"]["getPublicClient"]>>,
  name: string,
  address: Address,
) {
  const code = await publicClient.getCode({ address });
  if (code === undefined || code === "0x") {
    throw new Error(`${name} has no contract code on Arbitrum One: ${address}`);
  }
}

const connection = await network.create();
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
if (chainId !== ARBITRUM_ONE_CHAIN_ID) {
  throw new Error(`Expected Arbitrum One chainId ${ARBITRUM_ONE_CHAIN_ID}, got ${chainId}`);
}
const prefix = envPrefix(connection.networkName);

const accountImplementation = requiredNetworkAddress(prefix, "ACCOUNT_IMPLEMENTATION");
const userAddress = requiredNetworkAddress(prefix, "USER_ADDRESS");
const merchantAddress = requiredNetworkAddress(prefix, "MERCHANT_ADDRESS");
const usdcAddress = requiredNetworkAddress(prefix, "USDC_TOKEN_ADDRESS");
const paymentRecipients =
  networkEnv(prefix, "PAYMENT_RECIPIENTS") === undefined
    ? [merchantAddress]
    : requiredNetworkAddressList(prefix, "PAYMENT_RECIPIENTS");
const paymentAmounts =
  networkEnv(prefix, "PAYMENT_AMOUNTS") === undefined
    ? [requiredNetworkBigInt(prefix, "PAYMENT_AMOUNT")]
    : requiredNetworkBigIntList(prefix, "PAYMENT_AMOUNTS");

if (getAddress(usdcAddress) !== ARBITRUM_ONE_NATIVE_USDC) {
  throw new Error(`USDC_TOKEN_ADDRESS must be Arbitrum native USDC ${ARBITRUM_ONE_NATIVE_USDC}`);
}
if (paymentRecipients.length !== paymentAmounts.length) {
  throw new Error(
    `PAYMENT_RECIPIENTS length ${paymentRecipients.length} must match PAYMENT_AMOUNTS length ${paymentAmounts.length}`,
  );
}
if (paymentAmounts.some((amount) => amount === 0n)) {
  throw new Error("All payment amounts must be greater than 0");
}

const userAccount = privateKeyToAccount(requiredNetworkPrivateKey(prefix, "USER_PRIVATE_KEY"));
const userWalletClient = createWalletClient({
  account: userAccount,
  chain: arbitrum,
  transport: http(requiredNetworkEnv(prefix, "RPC_URL")),
});

assertExpectedAddress("USER_ADDRESS", userAccount.address, userAddress);

await requireContractCode(publicClient, "ACCOUNT_IMPLEMENTATION", accountImplementation);
await requireContractCode(publicClient, "USDC_TOKEN_ADDRESS", usdcAddress);

const account = await viem.getContractAt("Sponsored7702Account", userAddress);
const currentCode = await publicClient.getCode({ address: userAddress });
const delegationTarget = getDelegationTarget(currentCode);
const needsAuthorization = delegationTarget === undefined;
if (delegationTarget !== undefined && getAddress(delegationTarget) !== getAddress(accountImplementation)) {
  throw new Error(
    `USER_ADDRESS is delegated to ${delegationTarget}, but ACCOUNT_IMPLEMENTATION is ${accountImplementation}`,
  );
}

const decimals = await publicClient.readContract({
  address: usdcAddress,
  abi: erc20Abi,
  functionName: "decimals",
});
const totalPaymentAmount = paymentAmounts.reduce((sum, amount) => sum + amount, 0n);

const expectedTokenDeltas = new Map<Address, bigint>();
addDelta(expectedTokenDeltas, userAddress, -totalPaymentAmount);
for (let i = 0; i < paymentRecipients.length; i += 1) {
  addDelta(expectedTokenDeltas, paymentRecipients[i], paymentAmounts[i]);
}

const balancesBefore = new Map<Address, bigint>();
for (const address of expectedTokenDeltas.keys()) {
  balancesBefore.set(
    address,
    await publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
  );
}
const userBalanceBefore = balancesBefore.get(userAddress) ?? 0n;
const userNativeBalanceBefore = await publicClient.getBalance({ address: userAddress });
const sponsoredNonceBefore = needsAuthorization ? undefined : await account.read.getNonce();

if (userBalanceBefore < totalPaymentAmount) {
  throw new Error(`USER_ADDRESS USDC balance is too low: balance=${userBalanceBefore}, required=${totalPaymentAmount}`);
}
if (userNativeBalanceBefore === 0n) {
  throw new Error(`USER_ADDRESS has no Arbitrum ETH for self execution gas: ${userAddress}`);
}

const calls: Call[] = paymentRecipients.map((recipient, index) => ({
  target: usdcAddress,
  value: 0n,
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, paymentAmounts[index]],
  }),
}));
const data = encodeFunctionData({
  abi: account.abi,
  functionName: "executeFromSelf",
  args: [calls],
});

console.log("Arbitrum One self-payment preflight:");
console.log(`  chainId: ${chainId}`);
console.log(`  user: ${userAddress}`);
console.log(`  token: ${usdcAddress}`);
console.log(`  needs EIP-7702 authorization: ${needsAuthorization}`);
console.log(`  account nonce: ${sponsoredNonceBefore ?? "n/a (not delegated yet)"}`);
console.log(`  calls: ${calls.length}`);
console.log(`  user USDC balance: ${formatUnits(userBalanceBefore, decimals)}`);
console.log(`  total payment: ${formatUnits(totalPaymentAmount, decimals)}`);
console.log(`  user ETH (pays own gas): ${formatEther(userNativeBalanceBefore)}`);
console.log("\nExpected token deltas:");
for (const [address, delta] of expectedTokenDeltas) {
  const sign = delta < 0n ? "-" : "+";
  console.log(`  ${address}: ${sign}${formatUnits(delta < 0n ? -delta : delta, decimals)}`);
}

if (isDryRun()) {
  console.log("\nDry run enabled; not signing and not sending a transaction.");
  process.exit(0);
}

const authorizationList = needsAuthorization
  ? [
      await userWalletClient.signAuthorization({
        account: userAccount,
        contractAddress: accountImplementation,
        executor: "self",
      }),
    ]
  : undefined;

console.log("Sending executeFromSelf transaction from user...");
console.log(`user/account: ${userAddress}`);
console.log(`authorization: ${needsAuthorization ? "included" : "already delegated"}`);
const hash = await userWalletClient.sendTransaction({
  account: userAccount,
  to: userAddress,
  data,
  ...(authorizationList === undefined ? {} : { authorizationList }),
});
console.log(`tx: ${hash}`);
console.log(`Arbiscan: https://arbiscan.io/tx/${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`status: ${receipt.status}`);
console.log(`gasUsed: ${receipt.gasUsed}`);
if (receipt.status !== "success") {
  throw new Error(`executeFromSelf transaction reverted: ${hash}`);
}

const transferLogs = parseEventLogs({
  abi: erc20Abi,
  eventName: "Transfer",
  logs: receipt.logs,
}).filter((log) => getAddress(log.address) === usdcAddress);

const userNativeBalanceAfter = await publicClient.getBalance({ address: userAddress });
const sponsoredNonceAfter = await account.read.getNonce();
if (sponsoredNonceBefore !== undefined && sponsoredNonceAfter !== sponsoredNonceBefore) {
  throw new Error(`executeFromSelf consumed sponsored nonce: before=${sponsoredNonceBefore}, after=${sponsoredNonceAfter}`);
}

console.log("\nFinal state:");
console.log(`  account sponsored nonce: ${sponsoredNonceAfter}`);
console.log(`  token: ${usdcAddress}`);
console.log(`  user ETH gas delta: ${formatEther(userNativeBalanceBefore - userNativeBalanceAfter)}`);

for (const [address, expectedDelta] of expectedTokenDeltas) {
  const before = balancesBefore.get(address) ?? 0n;
  const after = await publicClient.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
  const actualDelta = after - before;
  if (actualDelta !== expectedDelta) {
    throw new Error(`Unexpected USDC delta for ${address}: got=${actualDelta}, expected=${expectedDelta}`);
  }
  console.log(`  ${address} USDC delta: ${formatUnits(actualDelta, decimals)}`);
}

console.log("\nArbiscan should show these USDC Transfer events:");
for (let i = 0; i < paymentRecipients.length; i += 1) {
  console.log(`  ${userAddress} -> ${paymentRecipients[i]}: ${formatUnits(paymentAmounts[i], decimals)}`);
}
console.log(`Observed USDC Transfer logs in tx: ${transferLogs.length}`);
