import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";

import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, bsc, mainnet, type Chain } from "viem/chains";

type ChainKey = "ethereum" | "bsc" | "arbitrumOne";
type ApplyStatus = "submitted" | "skipped_already_supported" | "failed";

type MissingFeeToken = {
  chainKey: ChainKey;
  chainId: number;
  chain: Chain;
  envPrefix: "ETHEREUM" | "BSC" | "ARBITRUM_ONE";
  privateKeyEnv: "ETHEREUM_PRIVATE_KEY" | "BSC_PRIVATE_KEY" | "ARBITRUM_ONE_PRIVATE_KEY";
  tokenSymbol: "USDT" | "USDC";
  tokenAddress: Address;
  expectedDecimals: number;
  note?: string;
};

type ApplyResult = {
  chainKey: ChainKey;
  chainId: number;
  policyRegistry: Address;
  registryOwner: Address;
  signerAddress: Address;
  tokenSymbolConfigured: string;
  tokenAddress: Address;
  onchainSymbol: string;
  onchainDecimals: number;
  beforeIsSupportedFeeToken: boolean;
  afterIsSupportedFeeToken: boolean | null;
  txHash: Hex | null;
  blockNumber: string | null;
  gasUsed: string | null;
  status: ApplyStatus;
  note: string;
};

const REPORT_MD_PATH = "evm-7702-sponsored/reports/fee-token-whitelist-apply-result.md";
const REPORT_JSON_PATH = "evm-7702-sponsored/reports/fee-token-whitelist-apply-result.json";

const TOKENS_TO_APPLY: readonly MissingFeeToken[] = [
  {
    chainKey: "ethereum",
    chainId: 1,
    chain: mainnet,
    envPrefix: "ETHEREUM",
    privateKeyEnv: "ETHEREUM_PRIVATE_KEY",
    tokenSymbol: "USDT",
    tokenAddress: getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7"),
    expectedDecimals: 6,
  },
  {
    chainKey: "bsc",
    chainId: 56,
    chain: bsc,
    envPrefix: "BSC",
    privateKeyEnv: "BSC_PRIVATE_KEY",
    tokenSymbol: "USDC",
    tokenAddress: getAddress("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"),
    expectedDecimals: 18,
  },
  {
    chainKey: "arbitrumOne",
    chainId: 42161,
    chain: arbitrum,
    envPrefix: "ARBITRUM_ONE",
    privateKeyEnv: "ARBITRUM_ONE_PRIVATE_KEY",
    tokenSymbol: "USDT",
    tokenAddress: getAddress("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"),
    expectedDecimals: 6,
    note: "Arbitrum on-chain symbol is USDt0 / USDT0; treat as USDT-compatible.",
  },
];

const POLICY_REGISTRY_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "feeReceiver",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "isSupportedFeeToken",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setSupportedFeeToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "supported", type: "bool" },
    ],
    outputs: [],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function requiredAddressEnv(name: string): Address {
  const value = requiredEnv(name);
  if (!isAddress(value)) {
    throw new Error(`${name} must be a valid 0x address`);
  }

  return getAddress(value);
}

function optionalAddressEnv(name: string): Address | null {
  const value = optionalEnv(name);
  if (value === undefined) {
    return null;
  }
  if (!isAddress(value)) {
    throw new Error(`${name} must be a valid 0x address`);
  }

  return getAddress(value);
}

function requiredPrivateKeyEnv(name: string): Hex {
  const value = requiredEnv(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte private key with 0x prefix`);
  }

  return value as Hex;
}

function hasCode(code: Hex | undefined): boolean {
  return code !== undefined && code !== "0x";
}

function markdownEscape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

async function requireCode(client: PublicClient, label: string, address: Address) {
  const code = await client.getCode({ address });
  if (!hasCode(code)) {
    throw new Error(`${label} has no contract code: ${address}`);
  }
}

function applyConfirmed() {
  return optionalEnv("CONFIRM_APPLY_FEE_TOKEN_WHITELIST") === "true";
}

async function safeReadFeeReceiver(config: MissingFeeToken, registry: Address | null) {
  const rpcUrl = optionalEnv(`${config.envPrefix}_RPC_URL`);
  if (rpcUrl === undefined || registry === null) {
    return "unavailable";
  }

  try {
    const publicClient = createPublicClient({
      chain: config.chain,
      transport: http(rpcUrl),
    });
    return await publicClient.readContract({
      address: registry,
      abi: POLICY_REGISTRY_ABI,
      functionName: "feeReceiver",
    });
  } catch {
    return "unavailable";
  }
}

async function printStartupPlan() {
  console.log("Fee token whitelist apply startup plan:");
  for (const config of TOKENS_TO_APPLY) {
    const registry = optionalAddressEnv(`${config.envPrefix}_POLICY_REGISTRY`);
    const sponsor = optionalAddressEnv(`${config.envPrefix}_SPONSOR_ADDRESS`);
    const feeReceiver = await safeReadFeeReceiver(config, registry);
    console.log(
      `- chain=${config.chainKey} chainId=${config.chainId} token=${config.tokenSymbol} tokenAddress=${config.tokenAddress} registry=${registry ?? "missing"} sponsor=${sponsor ?? "missing"} feeReceiver=${feeReceiver} amount=n/a whitelistOnly=setSupportedFeeToken(token,true)`,
    );
  }
}

async function applyToken(config: MissingFeeToken): Promise<ApplyResult> {
  const rpcUrl = requiredEnv(`${config.envPrefix}_RPC_URL`);
  const policyRegistry = requiredAddressEnv(`${config.envPrefix}_POLICY_REGISTRY`);
  const account = privateKeyToAccount(requiredPrivateKeyEnv(config.privateKeyEnv));
  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: config.chain,
    transport: http(rpcUrl),
  });
  const rpcChainId = await publicClient.getChainId();
  if (rpcChainId !== config.chainId) {
    throw new Error(`${config.envPrefix}_RPC_URL chainId mismatch: expected ${config.chainId}, got ${rpcChainId}`);
  }

  await requireCode(publicClient, `${config.chainKey} policy registry`, policyRegistry);
  await requireCode(publicClient, `${config.chainKey} ${config.tokenSymbol} token`, config.tokenAddress);

  const [registryOwner, onchainSymbol, onchainDecimals, beforeIsSupportedFeeToken] = await Promise.all([
    publicClient.readContract({
      address: policyRegistry,
      abi: POLICY_REGISTRY_ABI,
      functionName: "owner",
    }),
    publicClient.readContract({
      address: config.tokenAddress,
      abi: ERC20_ABI,
      functionName: "symbol",
    }),
    publicClient.readContract({
      address: config.tokenAddress,
      abi: ERC20_ABI,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: policyRegistry,
      abi: POLICY_REGISTRY_ABI,
      functionName: "isSupportedFeeToken",
      args: [config.tokenAddress],
    }),
  ]);
  const signerAddress = getAddress(account.address);
  if (getAddress(registryOwner) !== signerAddress) {
    throw new Error(
      `${config.chainKey} signer ${signerAddress} is not registry owner ${getAddress(registryOwner)}; refusing to broadcast`,
    );
  }
  if (Number(onchainDecimals) !== config.expectedDecimals) {
    throw new Error(
      `${config.chainKey} ${config.tokenSymbol} decimals mismatch: expected ${config.expectedDecimals}, got ${Number(onchainDecimals)}`,
    );
  }
  if (beforeIsSupportedFeeToken) {
    return {
      chainKey: config.chainKey,
      chainId: config.chainId,
      policyRegistry,
      registryOwner: getAddress(registryOwner),
      signerAddress,
      tokenSymbolConfigured: config.tokenSymbol,
      tokenAddress: config.tokenAddress,
      onchainSymbol,
      onchainDecimals: Number(onchainDecimals),
      beforeIsSupportedFeeToken,
      afterIsSupportedFeeToken: beforeIsSupportedFeeToken,
      txHash: null,
      blockNumber: null,
      gasUsed: null,
      status: "skipped_already_supported",
      note: "Token was already whitelisted before this script attempted a write.",
    };
  }

  const { request } = await publicClient.simulateContract({
    account,
    address: policyRegistry,
    abi: POLICY_REGISTRY_ABI,
    functionName: "setSupportedFeeToken",
    args: [config.tokenAddress, true],
  });
  const txHash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 180_000,
  });
  if (receipt.status !== "success") {
    throw new Error(`${config.chainKey} whitelist transaction reverted: ${txHash}`);
  }

  const afterIsSupportedFeeToken = await publicClient.readContract({
    address: policyRegistry,
    abi: POLICY_REGISTRY_ABI,
    functionName: "isSupportedFeeToken",
    args: [config.tokenAddress],
  });
  if (!afterIsSupportedFeeToken) {
    throw new Error(`${config.chainKey} transaction succeeded but token is still not supported: ${txHash}`);
  }

  return {
    chainKey: config.chainKey,
    chainId: config.chainId,
    policyRegistry,
    registryOwner: getAddress(registryOwner),
    signerAddress,
    tokenSymbolConfigured: config.tokenSymbol,
    tokenAddress: config.tokenAddress,
    onchainSymbol,
    onchainDecimals: Number(onchainDecimals),
    beforeIsSupportedFeeToken,
    afterIsSupportedFeeToken,
    txHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    status: "submitted",
    note: [
      "Whitelist write succeeded. This does not mark SDK verified=true and does not replace small-value canary.",
      config.note,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

function buildMarkdownReport(results: readonly ApplyResult[]) {
  const generatedAt = new Date().toISOString();
  const header = [
    "# Fee Token Whitelist Apply Result",
    "",
    `Generated at: ${generatedAt}`,
    "",
    "This report records owner-signed registry writes for missing fee token whitelist entries. It does not imply production canary verification is complete.",
    "",
    "| chainKey | chainId | policyRegistry | registryOwner | signerAddress | tokenSymbolConfigured | tokenAddress | onchainSymbol | onchainDecimals | beforeIsSupportedFeeToken | afterIsSupportedFeeToken | txHash | blockNumber | gasUsed | status | note |",
    "| --- | ---: | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | ---: | ---: | --- | --- |",
  ];
  const rows = results.map((result) =>
    [
      result.chainKey,
      result.chainId,
      result.policyRegistry,
      result.registryOwner,
      result.signerAddress,
      result.tokenSymbolConfigured,
      result.tokenAddress,
      result.onchainSymbol,
      result.onchainDecimals,
      result.beforeIsSupportedFeeToken,
      result.afterIsSupportedFeeToken,
      result.txHash ?? "none",
      result.blockNumber ?? "none",
      result.gasUsed ?? "none",
      result.status,
      result.note,
    ]
      .map(markdownEscape)
      .join(" | "),
  );

  return `${header.join("\n")}\n${rows.map((row) => `| ${row} |`).join("\n")}\n`;
}

function printSummary(results: readonly ApplyResult[]) {
  console.log("Fee token whitelist apply completed.");
  console.log("");
  for (const result of results) {
    console.log(
      `- ${result.chainKey} ${result.tokenSymbolConfigured}: ${result.status}, before=${result.beforeIsSupportedFeeToken}, after=${result.afterIsSupportedFeeToken}, tx=${result.txHash ?? "none"}`,
    );
  }
  console.log("");
  console.log(`Markdown report: ${REPORT_MD_PATH}`);
  console.log(`JSON report: ${REPORT_JSON_PATH}`);
}

async function main() {
  await printStartupPlan();
  if (!applyConfirmed()) {
    console.log("");
    console.log(
      "Safety switch is off. Set CONFIRM_APPLY_FEE_TOKEN_WHITELIST=true to allow owner-signed whitelist transactions.",
    );
    console.log("Exiting without deriving owner private keys, simulating writes, or sending transactions.");
    return;
  }

  const results: ApplyResult[] = [];
  for (const config of TOKENS_TO_APPLY) {
    console.log(`Applying ${config.chainKey} ${config.tokenSymbol} fee token whitelist...`);
    results.push(await applyToken(config));
  }

  const markdown = buildMarkdownReport(results);
  const json = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      warning: "Whitelist writes completed/skipped as listed. Production canary verification remains separate.",
      results,
    },
    null,
    2,
  );

  await mkdir("evm-7702-sponsored/reports", { recursive: true });
  await Promise.all([
    writeFile(REPORT_MD_PATH, markdown, "utf8"),
    writeFile(REPORT_JSON_PATH, `${json}\n`, "utf8"),
  ]);

  printSummary(results);
}

await main();
