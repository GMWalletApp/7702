import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";

import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

type ChainKey = "ethereum" | "bsc" | "arbitrumOne";
type RecommendedExecutor = "OWNER_EOA_CONFIRM_REQUIRED" | "MULTISIG_PROPOSAL_REQUIRED" | "BLOCKED_OWNER_UNKNOWN";

type MissingFeeToken = {
  chainKey: ChainKey;
  chainId: number;
  envPrefix: "ETHEREUM" | "BSC" | "ARBITRUM_ONE";
  tokenSymbol: "USDT" | "USDC";
  tokenAddress: Address;
  expectedDecimals: number;
  note?: string;
};

type CalldataReportRow = {
  chainKey: ChainKey;
  chainId: number;
  rpcChainId: number | null;
  policyRegistry: Address | null;
  hasRegistryCode: boolean;
  registryOwner: Address | null;
  ownerHasCode: boolean | null;
  tokenSymbolConfigured: string;
  tokenAddress: Address;
  hasTokenCode: boolean;
  onchainSymbol: string;
  onchainDecimals: number | null;
  expectedDecimals: number;
  currentIsSupportedFeeToken: boolean | null;
  functionName: "setSupportedFeeToken";
  args: {
    token: Address;
    supported: true;
  };
  calldata: Hex;
  recommendedExecutor: RecommendedExecutor;
  note: string;
};

const REPORT_MD_PATH = "evm-7702-sponsored/reports/fee-token-whitelist-calldata.md";
const REPORT_JSON_PATH = "evm-7702-sponsored/reports/fee-token-whitelist-calldata.json";

const MISSING_FEE_TOKEN_WHITELIST: readonly MissingFeeToken[] = [
  {
    chainKey: "ethereum",
    chainId: 1,
    envPrefix: "ETHEREUM",
    tokenSymbol: "USDT",
    tokenAddress: getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7"),
    expectedDecimals: 6,
  },
  {
    chainKey: "bsc",
    chainId: 56,
    envPrefix: "BSC",
    tokenSymbol: "USDC",
    tokenAddress: getAddress("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"),
    expectedDecimals: 18,
  },
  {
    chainKey: "arbitrumOne",
    chainId: 42161,
    envPrefix: "ARBITRUM_ONE",
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
  return value === "" ? undefined : value;
}

function optionalAddressEnv(name: string): Address | undefined {
  const value = optionalEnv(name);
  if (value === undefined) {
    return undefined;
  }
  if (!isAddress(value)) {
    throw new Error(`${name} must be a valid 0x address`);
  }

  return getAddress(value);
}

function hasCode(code: Hex | undefined): boolean {
  return code !== undefined && code !== "0x";
}

async function safeReadContract<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

async function safeGetCode(client: PublicClient, address: Address): Promise<Hex | undefined> {
  try {
    return await client.getCode({ address });
  } catch {
    return undefined;
  }
}

function buildWhitelistCalldata(token: Address): Hex {
  return encodeFunctionData({
    abi: POLICY_REGISTRY_ABI,
    functionName: "setSupportedFeeToken",
    args: [token, true],
  });
}

function chooseRecommendedExecutor(owner: Address | null, ownerHasCode: boolean | null): RecommendedExecutor {
  if (owner === null || ownerHasCode === null) {
    return "BLOCKED_OWNER_UNKNOWN";
  }

  return ownerHasCode ? "MULTISIG_PROPOSAL_REQUIRED" : "OWNER_EOA_CONFIRM_REQUIRED";
}

function buildNote(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join(" ");
}

function markdownEscape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

async function inspectMissingToken(config: MissingFeeToken): Promise<CalldataReportRow> {
  const rpcUrl = optionalEnv(`${config.envPrefix}_RPC_URL`);
  const policyRegistry = optionalAddressEnv(`${config.envPrefix}_POLICY_REGISTRY`) ?? null;
  const calldata = buildWhitelistCalldata(config.tokenAddress);
  const unavailableBase = {
    chainKey: config.chainKey,
    chainId: config.chainId,
    rpcChainId: null,
    policyRegistry,
    hasRegistryCode: false,
    registryOwner: null,
    ownerHasCode: null,
    tokenSymbolConfigured: config.tokenSymbol,
    tokenAddress: config.tokenAddress,
    hasTokenCode: false,
    onchainSymbol: "unavailable",
    onchainDecimals: null,
    expectedDecimals: config.expectedDecimals,
    currentIsSupportedFeeToken: null,
    functionName: "setSupportedFeeToken" as const,
    args: {
      token: config.tokenAddress,
      supported: true as const,
    },
    calldata,
    recommendedExecutor: "BLOCKED_OWNER_UNKNOWN" as const,
  };

  if (rpcUrl === undefined) {
    return {
      ...unavailableBase,
      note: buildNote([`Missing ${config.envPrefix}_RPC_URL; precheck skipped.`, config.note]),
    };
  }

  const client = createPublicClient({
    transport: http(rpcUrl),
  });
  const rpcChainId = await client.getChainId();
  if (rpcChainId !== config.chainId) {
    throw new Error(`${config.envPrefix}_RPC_URL chainId mismatch: expected ${config.chainId}, got ${rpcChainId}`);
  }

  const [tokenCode, onchainSymbol, onchainDecimals] = await Promise.all([
    safeGetCode(client, config.tokenAddress),
    safeReadContract(() =>
      client.readContract({
        address: config.tokenAddress,
        abi: ERC20_ABI,
        functionName: "symbol",
      }),
    ),
    safeReadContract(() =>
      client.readContract({
        address: config.tokenAddress,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
    ),
  ]);
  const hasTokenCode = hasCode(tokenCode);

  if (policyRegistry === null) {
    return {
      ...unavailableBase,
      rpcChainId,
      hasTokenCode,
      onchainSymbol: onchainSymbol ?? "unavailable",
      onchainDecimals: onchainDecimals === undefined ? null : Number(onchainDecimals),
      note: buildNote([`Missing ${config.envPrefix}_POLICY_REGISTRY.`, config.note]),
    };
  }

  const registryCode = await safeGetCode(client, policyRegistry);
  const hasRegistryCode = hasCode(registryCode);
  const [registryOwner, currentIsSupportedFeeToken] = hasRegistryCode
    ? await Promise.all([
        safeReadContract(() =>
          client.readContract({
            address: policyRegistry,
            abi: POLICY_REGISTRY_ABI,
            functionName: "owner",
          }),
        ),
        safeReadContract(() =>
          client.readContract({
            address: policyRegistry,
            abi: POLICY_REGISTRY_ABI,
            functionName: "isSupportedFeeToken",
            args: [config.tokenAddress],
          }),
        ),
      ])
    : [undefined, undefined];
  const ownerCode = registryOwner === undefined ? undefined : await safeGetCode(client, registryOwner);
  const ownerHasCode = registryOwner === undefined ? null : hasCode(ownerCode);
  const recommendedExecutor = chooseRecommendedExecutor(registryOwner ?? null, ownerHasCode);

  return {
    chainKey: config.chainKey,
    chainId: config.chainId,
    rpcChainId,
    policyRegistry,
    hasRegistryCode,
    registryOwner: registryOwner ?? null,
    ownerHasCode,
    tokenSymbolConfigured: config.tokenSymbol,
    tokenAddress: config.tokenAddress,
    hasTokenCode,
    onchainSymbol: onchainSymbol ?? "unavailable",
    onchainDecimals: onchainDecimals === undefined ? null : Number(onchainDecimals),
    expectedDecimals: config.expectedDecimals,
    currentIsSupportedFeeToken: currentIsSupportedFeeToken ?? null,
    functionName: "setSupportedFeeToken",
    args: {
      token: config.tokenAddress,
      supported: true,
    },
    calldata,
    recommendedExecutor,
    note: buildNote([
      !hasRegistryCode ? "Registry address is missing or has no contract code." : undefined,
      !hasTokenCode ? "Token address has no contract code." : undefined,
      onchainDecimals !== undefined && Number(onchainDecimals) !== config.expectedDecimals
        ? `Decimals mismatch: expected ${config.expectedDecimals}, got ${Number(onchainDecimals)}.`
        : undefined,
      currentIsSupportedFeeToken === true ? "Token is already whitelisted; do not execute unless rechecked." : undefined,
      currentIsSupportedFeeToken === false ? "Current registry value is false; calldata enables this fee token." : undefined,
      recommendedExecutor === "MULTISIG_PROPOSAL_REQUIRED"
        ? "Owner has contract code; prepare a multisig/governance proposal with this calldata."
        : undefined,
      recommendedExecutor === "OWNER_EOA_CONFIRM_REQUIRED"
        ? "Owner appears to be an EOA; owner must review and submit manually."
        : undefined,
      "Whitelist enablement does not mark SDK verified=true and does not replace small-value canary.",
      config.note,
    ]),
  };
}

function buildMarkdownReport(rows: readonly CalldataReportRow[]): string {
  const generatedAt = new Date().toISOString();
  const header = [
    "# Fee Token Whitelist Calldata Plan",
    "",
    `Generated at: ${generatedAt}`,
    "",
    "This is a read-only preparation report. The script only reads chain state and encodes calldata for `setSupportedFeeToken(address,bool)`. It does not broadcast transactions and does not call registry write methods.",
    "",
    "## Manual Execution Steps",
    "",
    "1. Confirm the policy registry address for the target chain.",
    "2. Confirm the registry owner and whether it is an EOA, multisig, or governance contract.",
    "3. Confirm the token address, on-chain symbol, and decimals.",
    "4. Execute the calldata through the owner EOA or create a multisig/governance proposal.",
    "5. After execution, rerun `evm-7702-sponsored/scripts/check-fee-token-whitelist.ts`.",
    "6. After the whitelist is confirmed, run a small-value canary for each token before production traffic.",
    "",
    "Do not update SDK `verified=false` to `true` from this report alone. A whitelist entry only means the token can be accepted as a fee token; production canary and reconciliation are separate gates.",
    "",
    "## Calldata",
    "",
    "| chainKey | chainId | policyRegistry | registryOwner | tokenSymbolConfigured | tokenAddress | onchainSymbol | onchainDecimals | currentIsSupportedFeeToken | functionName | args | calldata | recommendedExecutor | note |",
    "| --- | ---: | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |",
  ];
  const tableRows = rows.map((row) =>
    [
      row.chainKey,
      row.chainId,
      row.policyRegistry ?? "missing",
      row.registryOwner ?? "unknown",
      row.tokenSymbolConfigured,
      row.tokenAddress,
      row.onchainSymbol,
      row.onchainDecimals ?? "unavailable",
      row.currentIsSupportedFeeToken ?? "unavailable",
      row.functionName,
      JSON.stringify(row.args),
      row.calldata,
      row.recommendedExecutor,
      row.note,
    ]
      .map(markdownEscape)
      .join(" | "),
  );

  return `${header.join("\n")}\n${tableRows.map((row) => `| ${row} |`).join("\n")}\n`;
}

function printSummary(rows: readonly CalldataReportRow[]) {
  console.log("Fee token whitelist calldata prepared.");
  console.log("");
  for (const row of rows) {
    console.log(
      `- ${row.chainKey} ${row.tokenSymbolConfigured}: owner=${row.registryOwner ?? "unknown"}, executor=${row.recommendedExecutor}, currentSupported=${row.currentIsSupportedFeeToken ?? "unavailable"}`,
    );
  }
  console.log("");
  console.log(`Markdown report: ${REPORT_MD_PATH}`);
  console.log(`JSON report: ${REPORT_JSON_PATH}`);
}

async function main() {
  const rows = await Promise.all(MISSING_FEE_TOKEN_WHITELIST.map(inspectMissingToken));
  const markdown = buildMarkdownReport(rows);
  const json = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      warning:
        "Calldata only. Do not broadcast from this script. Whitelist enablement does not complete production canary verification.",
      rows,
    },
    null,
    2,
  );

  await mkdir("evm-7702-sponsored/reports", { recursive: true });
  await Promise.all([
    writeFile(REPORT_MD_PATH, markdown, "utf8"),
    writeFile(REPORT_JSON_PATH, `${json}\n`, "utf8"),
  ]);

  printSummary(rows);
}

await main();
