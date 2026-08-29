import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";

import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

type ChainKey = "ethereum" | "bsc" | "arbitrumOne";
type RecommendedAction =
  | "OK"
  | "NEEDS_FEE_TOKEN_WHITELIST"
  | "BLOCK_NO_TOKEN_CODE"
  | "BLOCK_DECIMALS_MISMATCH"
  | "BLOCK_REGISTRY_MISSING"
  | "NEEDS_SPONSOR_WHITELIST"
  | "NEEDS_CANARY";

type FeeTokenConfig = {
  chainKey: ChainKey;
  chainId: number;
  tokenSymbol: "USDT" | "USDC";
  tokenAddress: Address;
  expectedDecimals: number;
  needsCanary: boolean;
  note?: string;
};

type ChainConfig = {
  chainKey: ChainKey;
  chainId: number;
  envPrefix: "ETHEREUM" | "BSC" | "ARBITRUM_ONE";
};

type FeePolicyResult = {
  maxGasFeeAmount: string;
  maxServiceFeeAmount: string;
  maxTotalFeeAmount: string;
  maxCalls: string;
};

type FeePolicyReadResult = {
  maxGasFeeAmount: bigint;
  maxServiceFeeAmount: bigint;
  maxTotalFeeAmount: bigint;
  maxCalls: bigint;
};

type ReportRow = {
  chainKey: ChainKey;
  chainId: number;
  rpcChainId: number | null;
  registry: Address | null;
  hasRegistryCode: boolean;
  tokenSymbolConfigured: string;
  tokenAddress: Address;
  onchainName: string;
  onchainSymbol: string;
  onchainDecimals: number | null;
  expectedDecimals: number;
  hasTokenCode: boolean;
  isSupportedFeeToken: boolean | null;
  sponsorAddress: Address | null;
  isSponsorAllowed: boolean | null;
  router: Address | null;
  feeReceiver: Address | null;
  feePolicy: FeePolicyResult | null;
  recommendedAction: RecommendedAction;
  note: string;
};

const REPORT_MD_PATH = "evm-7702-sponsored/reports/fee-token-whitelist-status.md";
const REPORT_JSON_PATH = "evm-7702-sponsored/reports/fee-token-whitelist-status.json";

const CHAINS: readonly ChainConfig[] = [
  { chainKey: "ethereum", chainId: 1, envPrefix: "ETHEREUM" },
  { chainKey: "bsc", chainId: 56, envPrefix: "BSC" },
  { chainKey: "arbitrumOne", chainId: 42161, envPrefix: "ARBITRUM_ONE" },
];

const FEE_TOKEN_MATRIX: readonly FeeTokenConfig[] = [
  {
    chainKey: "ethereum",
    chainId: 1,
    tokenSymbol: "USDT",
    tokenAddress: getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7"),
    expectedDecimals: 6,
    needsCanary: true,
  },
  {
    chainKey: "ethereum",
    chainId: 1,
    tokenSymbol: "USDC",
    tokenAddress: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
    expectedDecimals: 6,
    needsCanary: false,
  },
  {
    chainKey: "bsc",
    chainId: 56,
    tokenSymbol: "USDT",
    tokenAddress: getAddress("0x55d398326f99059fF775485246999027B3197955"),
    expectedDecimals: 18,
    needsCanary: false,
  },
  {
    chainKey: "bsc",
    chainId: 56,
    tokenSymbol: "USDC",
    tokenAddress: getAddress("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"),
    expectedDecimals: 18,
    needsCanary: true,
  },
  {
    chainKey: "arbitrumOne",
    chainId: 42161,
    tokenSymbol: "USDT",
    tokenAddress: getAddress("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"),
    expectedDecimals: 6,
    needsCanary: true,
    note: "Arbitrum on-chain symbol may display as USDt0 / USDT0; business config treats it as USDT-compatible.",
  },
  {
    chainKey: "arbitrumOne",
    chainId: 42161,
    tokenSymbol: "USDC",
    tokenAddress: getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"),
    expectedDecimals: 6,
    needsCanary: false,
  },
];

const REGISTRY_ABI = [
  {
    type: "function",
    name: "router",
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
    name: "feePolicy",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "maxGasFeeAmount", type: "uint256" },
          { name: "maxServiceFeeAmount", type: "uint256" },
          { name: "maxTotalFeeAmount", type: "uint256" },
          { name: "maxCalls", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isSponsor",
    stateMutability: "view",
    inputs: [{ name: "sponsor", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isSupportedFeeToken",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
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
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
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

function formatFeePolicy(value: FeePolicyReadResult): FeePolicyResult {
  return {
    maxGasFeeAmount: value.maxGasFeeAmount.toString(),
    maxServiceFeeAmount: value.maxServiceFeeAmount.toString(),
    maxTotalFeeAmount: value.maxTotalFeeAmount.toString(),
    maxCalls: value.maxCalls.toString(),
  };
}

async function safeReadContract<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

async function readTokenMetadata(client: PublicClient, tokenAddress: Address) {
  const [code, symbol, decimals, name] = await Promise.all([
    client.getCode({ address: tokenAddress }),
    safeReadContract(() =>
      client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "symbol",
      }),
    ),
    safeReadContract(() =>
      client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
    ),
    safeReadContract(() =>
      client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "name",
      }),
    ),
  ]);

  return {
    hasTokenCode: hasCode(code),
    onchainSymbol: symbol ?? "unavailable",
    onchainDecimals: decimals === undefined ? null : Number(decimals),
    onchainName: name ?? "unavailable",
  };
}

function chooseRecommendedAction(input: {
  hasRegistryCode: boolean;
  hasTokenCode: boolean;
  onchainDecimals: number | null;
  expectedDecimals: number;
  isSupportedFeeToken: boolean | null;
  isSponsorAllowed: boolean | null;
  needsCanary: boolean;
}): RecommendedAction {
  if (!input.hasRegistryCode) {
    return "BLOCK_REGISTRY_MISSING";
  }
  if (!input.hasTokenCode) {
    return "BLOCK_NO_TOKEN_CODE";
  }
  if (input.onchainDecimals !== input.expectedDecimals) {
    return "BLOCK_DECIMALS_MISMATCH";
  }
  if (input.isSupportedFeeToken === false) {
    return "NEEDS_FEE_TOKEN_WHITELIST";
  }
  if (input.isSponsorAllowed === false) {
    return "NEEDS_SPONSOR_WHITELIST";
  }
  if (input.isSupportedFeeToken === true && input.needsCanary) {
    return "NEEDS_CANARY";
  }

  return "OK";
}

function buildNote(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join(" ");
}

function markdownEscape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function formatBoolean(value: boolean | null): string {
  if (value === null) {
    return "unavailable";
  }

  return value ? "true" : "false";
}

function rowLabel(row: ReportRow): string {
  return `${row.chainKey} ${row.tokenSymbolConfigured} (${row.tokenAddress})`;
}

function rowsForAction(rows: readonly ReportRow[], actions: readonly RecommendedAction[]): string[] {
  return rows
    .filter((row) => actions.includes(row.recommendedAction))
    .map((row) => `- ${rowLabel(row)}: ${row.recommendedAction}`);
}

function buildMarkdownReport(rows: readonly ReportRow[]): string {
  const generatedAt = new Date().toISOString();
  const header = [
    "# Fee Token Whitelist Status",
    "",
    `Generated at: ${generatedAt}`,
    "",
    "Read-only check. This report only uses RPC reads, `eth_call`, and `getCode`; it does not broadcast transactions or call registry write methods.",
    "",
    "| chainKey | chainId | registry | tokenSymbolConfigured | tokenAddress | onchainSymbol | onchainDecimals | expectedDecimals | hasTokenCode | isSupportedFeeToken | isSponsorAllowed | router | feeReceiver | recommendedAction | note |",
    "| --- | ---: | --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const tableRows = rows.map((row) =>
    [
      row.chainKey,
      row.chainId,
      row.registry ?? "missing",
      row.tokenSymbolConfigured,
      row.tokenAddress,
      row.onchainSymbol,
      row.onchainDecimals ?? "unavailable",
      row.expectedDecimals,
      row.hasTokenCode,
      formatBoolean(row.isSupportedFeeToken),
      formatBoolean(row.isSponsorAllowed),
      row.router ?? "unavailable",
      row.feeReceiver ?? "unavailable",
      row.recommendedAction,
      row.note,
    ]
      .map(markdownEscape)
      .join(" | "),
  );

  return `${header.join("\n")}\n${tableRows.map((row) => `| ${row} |`).join("\n")}\n`;
}

function printSummary(rows: readonly ReportRow[]) {
  const okRows = rowsForAction(rows, ["OK"]);
  const whitelistRows = rowsForAction(rows, ["NEEDS_FEE_TOKEN_WHITELIST"]);
  const blockedRows = rowsForAction(rows, [
    "BLOCK_NO_TOKEN_CODE",
    "BLOCK_DECIMALS_MISMATCH",
    "BLOCK_REGISTRY_MISSING",
    "NEEDS_SPONSOR_WHITELIST",
  ]);
  const canaryRows = rowsForAction(rows, ["NEEDS_CANARY"]);

  console.log("Fee token whitelist check completed.");
  console.log("");
  console.log("OK:");
  console.log(okRows.length > 0 ? okRows.join("\n") : "- none");
  console.log("");
  console.log("Need whitelist:");
  console.log(whitelistRows.length > 0 ? whitelistRows.join("\n") : "- none");
  console.log("");
  console.log("Blocked:");
  console.log(blockedRows.length > 0 ? blockedRows.join("\n") : "- none");
  console.log("");
  console.log("Need canary:");
  console.log(canaryRows.length > 0 ? canaryRows.join("\n") : "- none");
}

async function checkChain(chain: ChainConfig): Promise<ReportRow[]> {
  const rpcUrl = optionalEnv(`${chain.envPrefix}_RPC_URL`);
  const registry = optionalAddressEnv(`${chain.envPrefix}_POLICY_REGISTRY`) ?? null;
  const sponsorAddress = optionalAddressEnv(`${chain.envPrefix}_SPONSOR_ADDRESS`) ?? null;
  const routerEnv = optionalAddressEnv(`${chain.envPrefix}_SPONSOR_ROUTER`) ?? null;
  const chainTokens = FEE_TOKEN_MATRIX.filter((token) => token.chainKey === chain.chainKey);

  if (rpcUrl === undefined) {
    return chainTokens.map((token) => ({
      chainKey: chain.chainKey,
      chainId: chain.chainId,
      rpcChainId: null,
      registry,
      hasRegistryCode: false,
      tokenSymbolConfigured: token.tokenSymbol,
      tokenAddress: token.tokenAddress,
      onchainName: "unavailable",
      onchainSymbol: "unavailable",
      onchainDecimals: null,
      expectedDecimals: token.expectedDecimals,
      hasTokenCode: false,
      isSupportedFeeToken: null,
      sponsorAddress,
      isSponsorAllowed: null,
      router: routerEnv,
      feeReceiver: null,
      feePolicy: null,
      recommendedAction: "BLOCK_REGISTRY_MISSING",
      note: buildNote([`Missing ${chain.envPrefix}_RPC_URL; read-only checks skipped.`, token.note]),
    }));
  }

  const client = createPublicClient({
    transport: http(rpcUrl),
  });
  const rpcChainId = await client.getChainId();
  if (rpcChainId !== chain.chainId) {
    throw new Error(`${chain.envPrefix}_RPC_URL chainId mismatch: expected ${chain.chainId}, got ${rpcChainId}`);
  }

  if (registry === null) {
    const tokenMetadata = await Promise.all(
      chainTokens.map((token) => readTokenMetadata(client, token.tokenAddress)),
    );

    return chainTokens.map((token, index) => ({
      chainKey: chain.chainKey,
      chainId: chain.chainId,
      rpcChainId,
      registry,
      hasRegistryCode: false,
      tokenSymbolConfigured: token.tokenSymbol,
      tokenAddress: token.tokenAddress,
      onchainName: tokenMetadata[index].onchainName,
      onchainSymbol: tokenMetadata[index].onchainSymbol,
      onchainDecimals: tokenMetadata[index].onchainDecimals,
      expectedDecimals: token.expectedDecimals,
      hasTokenCode: tokenMetadata[index].hasTokenCode,
      isSupportedFeeToken: null,
      sponsorAddress,
      isSponsorAllowed: null,
      router: routerEnv,
      feeReceiver: null,
      feePolicy: null,
      recommendedAction: "BLOCK_REGISTRY_MISSING",
      note: buildNote([`Missing ${chain.envPrefix}_POLICY_REGISTRY.`, token.note]),
    }));
  }

  const registryCode = await client.getCode({ address: registry });
  const hasRegistryCode = hasCode(registryCode);

  const [router, feeReceiver, feePolicy, isSponsorAllowed] = hasRegistryCode
    ? await Promise.all([
        safeReadContract(() =>
          client.readContract({
            address: registry,
            abi: REGISTRY_ABI,
            functionName: "router",
          }),
        ),
        safeReadContract(() =>
          client.readContract({
            address: registry,
            abi: REGISTRY_ABI,
            functionName: "feeReceiver",
          }),
        ),
        safeReadContract(() =>
          client.readContract({
            address: registry,
            abi: REGISTRY_ABI,
            functionName: "feePolicy",
          }),
        ),
        sponsorAddress === null
          ? Promise.resolve(undefined)
          : safeReadContract(() =>
              client.readContract({
                address: registry,
                abi: REGISTRY_ABI,
                functionName: "isSponsor",
                args: [sponsorAddress],
              }),
            ),
      ])
    : [undefined, undefined, undefined, undefined];

  const rows = await Promise.all(
    chainTokens.map(async (token): Promise<ReportRow> => {
      const tokenMetadata = await readTokenMetadata(client, token.tokenAddress);
      const isSupportedFeeToken = hasRegistryCode
        ? await safeReadContract(() =>
            client.readContract({
              address: registry,
              abi: REGISTRY_ABI,
              functionName: "isSupportedFeeToken",
              args: [token.tokenAddress],
            }),
          )
        : undefined;
      const recommendedAction = chooseRecommendedAction({
        hasRegistryCode,
        hasTokenCode: tokenMetadata.hasTokenCode,
        onchainDecimals: tokenMetadata.onchainDecimals,
        expectedDecimals: token.expectedDecimals,
        isSupportedFeeToken: isSupportedFeeToken ?? null,
        isSponsorAllowed: sponsorAddress === null ? null : (isSponsorAllowed ?? null),
        needsCanary: token.needsCanary,
      });
      const note = buildNote([
        !hasRegistryCode ? "Registry address is missing or has no contract code." : undefined,
        routerEnv !== null && router !== undefined && routerEnv !== router
          ? `Router env mismatch: ${chain.envPrefix}_SPONSOR_ROUTER=${routerEnv}, registry.router=${router}.`
          : undefined,
        recommendedAction === "NEEDS_CANARY"
          ? "Fee token is whitelisted, but this token still needs a real small-value canary and reconciliation before production."
          : undefined,
        token.note,
      ]);

      return {
        chainKey: chain.chainKey,
        chainId: chain.chainId,
        rpcChainId,
        registry,
        hasRegistryCode,
        tokenSymbolConfigured: token.tokenSymbol,
        tokenAddress: token.tokenAddress,
        onchainName: tokenMetadata.onchainName,
        onchainSymbol: tokenMetadata.onchainSymbol,
        onchainDecimals: tokenMetadata.onchainDecimals,
        expectedDecimals: token.expectedDecimals,
        hasTokenCode: tokenMetadata.hasTokenCode,
        isSupportedFeeToken: isSupportedFeeToken ?? null,
        sponsorAddress,
        isSponsorAllowed: sponsorAddress === null ? null : (isSponsorAllowed ?? null),
        router: router ?? routerEnv ?? null,
        feeReceiver: feeReceiver ?? null,
        feePolicy: feePolicy === undefined ? null : formatFeePolicy(feePolicy),
        recommendedAction,
        note,
      };
    }),
  );

  return rows;
}

async function main() {
  const rows = (await Promise.all(CHAINS.map(checkChain))).flat();
  const markdown = buildMarkdownReport(rows);
  const json = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      warning:
        "Read-only report. Whitelist status does not mean production canary verification is complete.",
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
  console.log("");
  console.log(`Markdown report: ${REPORT_MD_PATH}`);
  console.log(`JSON report: ${REPORT_JSON_PATH}`);
}

await main();
