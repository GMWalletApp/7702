import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";

import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

type ChainKey = "ethereum" | "bsc" | "arbitrumOne";
type RecommendedAction =
  | "READY_FOR_MANUAL_CANARY"
  | "BLOCK_BALANCE_TOO_LOW"
  | "BLOCK_TOKEN_NOT_WHITELISTED"
  | "BLOCK_SPONSOR_NOT_ALLOWED"
  | "BLOCK_CONTRACT_MISSING"
  | "BLOCK_DECIMALS_MISMATCH";

type PreflightStatus = "PASS" | "BLOCKED";

type CanaryTokenConfig = {
  chainKey: ChainKey;
  chainId: number;
  envPrefix: "ETHEREUM" | "BSC" | "ARBITRUM_ONE";
  tokenSymbol: "USDT" | "USDC";
  tokenAddress: Address;
  expectedDecimals: number;
  note?: string;
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

type CanaryPlanRow = {
  chainKey: ChainKey;
  chainId: number;
  rpcChainId: number | null;
  tokenSymbol: string;
  tokenAddress: Address;
  onchainSymbol: string;
  decimals: number | null;
  expectedDecimals: number;
  user: Address | null;
  sponsor: Address | null;
  router: Address | null;
  registry: Address | null;
  accountImplementation: Address | null;
  feeReceiver: Address | null;
  feePolicy: FeePolicyResult | null;
  paymentAmount: string;
  gasFeeAmount: string;
  serviceFeeAmount: string;
  totalFeeAmount: string;
  totalRequiredAmount: string;
  userBalance: string;
  userBalanceFormatted: string;
  hasRegistryCode: boolean;
  hasRouterCode: boolean;
  hasAccountImplementationCode: boolean;
  hasTokenCode: boolean;
  isSupportedFeeToken: boolean | null;
  isSponsorAllowed: boolean | null;
  feePolicyAllowsAmounts: boolean | null;
  preflightStatus: PreflightStatus;
  recommendedAction: RecommendedAction;
  note: string;
};

const REPORT_MD_PATH = "evm-7702-sponsored/reports/canary-plan.md";
const REPORT_JSON_PATH = "evm-7702-sponsored/reports/canary-plan.json";

const CANARY_TOKEN_MATRIX: readonly CanaryTokenConfig[] = [
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
    note: "Arbitrum on-chain symbol may display as USDt0 / USDT0; business config treats it as USDT-compatible.",
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
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
}

function networkEnv(prefix: string, name: string): string | undefined {
  return optionalEnv(`${prefix}_${name}`) ?? optionalEnv(name);
}

function optionalNetworkAddress(prefix: string, name: string): Address | null {
  const value = networkEnv(prefix, name);
  if (value === undefined) {
    return null;
  }
  if (!isAddress(value)) {
    throw new Error(`${prefix}_${name} or ${name} must be a valid 0x address`);
  }

  return getAddress(value);
}

function optionalNetworkBigInt(prefix: string, name: string): bigint | null {
  const value = networkEnv(prefix, name);
  if (value === undefined) {
    return null;
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${prefix}_${name} or ${name} must be a non-negative integer string`);
  }

  return BigInt(value);
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

async function safeGetCode(client: PublicClient, address: Address | null): Promise<boolean> {
  if (address === null) {
    return false;
  }

  try {
    return hasCode(await client.getCode({ address }));
  } catch {
    return false;
  }
}

function formatFeePolicy(value: FeePolicyReadResult): FeePolicyResult {
  return {
    maxGasFeeAmount: value.maxGasFeeAmount.toString(),
    maxServiceFeeAmount: value.maxServiceFeeAmount.toString(),
    maxTotalFeeAmount: value.maxTotalFeeAmount.toString(),
    maxCalls: value.maxCalls.toString(),
  };
}

function feePolicyAllowsAmounts(
  feePolicy: FeePolicyReadResult | undefined,
  gasFeeAmount: bigint,
  serviceFeeAmount: bigint,
): boolean | null {
  if (feePolicy === undefined) {
    return null;
  }

  const totalFeeAmount = gasFeeAmount + serviceFeeAmount;
  return (
    gasFeeAmount <= feePolicy.maxGasFeeAmount &&
    serviceFeeAmount <= feePolicy.maxServiceFeeAmount &&
    totalFeeAmount <= feePolicy.maxTotalFeeAmount
  );
}

function chooseRecommendedAction(input: {
  hasRegistryCode: boolean;
  hasRouterCode: boolean;
  hasAccountImplementationCode: boolean;
  hasTokenCode: boolean;
  decimals: number | null;
  expectedDecimals: number;
  isSupportedFeeToken: boolean | null;
  isSponsorAllowed: boolean | null;
  userBalance: bigint;
  totalRequiredAmount: bigint;
}): RecommendedAction {
  if (!input.hasRegistryCode || !input.hasRouterCode || !input.hasAccountImplementationCode || !input.hasTokenCode) {
    return "BLOCK_CONTRACT_MISSING";
  }
  if (input.decimals !== input.expectedDecimals) {
    return "BLOCK_DECIMALS_MISMATCH";
  }
  if (input.isSupportedFeeToken !== true) {
    return "BLOCK_TOKEN_NOT_WHITELISTED";
  }
  if (input.isSponsorAllowed !== true) {
    return "BLOCK_SPONSOR_NOT_ALLOWED";
  }
  if (input.userBalance < input.totalRequiredAmount) {
    return "BLOCK_BALANCE_TOO_LOW";
  }

  return "READY_FOR_MANUAL_CANARY";
}

function buildNote(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join(" ");
}

function markdownEscape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

async function buildCanaryPlan(config: CanaryTokenConfig): Promise<CanaryPlanRow> {
  const rpcUrl = networkEnv(config.envPrefix, "RPC_URL");
  const registry = optionalNetworkAddress(config.envPrefix, "POLICY_REGISTRY");
  const router = optionalNetworkAddress(config.envPrefix, "SPONSOR_ROUTER");
  const accountImplementation = optionalNetworkAddress(config.envPrefix, "ACCOUNT_IMPLEMENTATION");
  const sponsor = optionalNetworkAddress(config.envPrefix, "SPONSOR_ADDRESS");
  const user = optionalNetworkAddress(config.envPrefix, "USER_ADDRESS");
  const paymentAmount = optionalNetworkBigInt(config.envPrefix, "PAYMENT_AMOUNT") ?? 0n;
  const gasFeeAmount = optionalNetworkBigInt(config.envPrefix, "GAS_FEE_AMOUNT") ?? 0n;
  const serviceFeeAmount = optionalNetworkBigInt(config.envPrefix, "SERVICE_FEE_AMOUNT") ?? 0n;
  const totalFeeAmount = gasFeeAmount + serviceFeeAmount;
  const totalRequiredAmount = paymentAmount + totalFeeAmount;

  if (rpcUrl === undefined) {
    return {
      chainKey: config.chainKey,
      chainId: config.chainId,
      rpcChainId: null,
      tokenSymbol: config.tokenSymbol,
      tokenAddress: config.tokenAddress,
      onchainSymbol: "unavailable",
      decimals: null,
      expectedDecimals: config.expectedDecimals,
      user,
      sponsor,
      router,
      registry,
      accountImplementation,
      feeReceiver: null,
      feePolicy: null,
      paymentAmount: paymentAmount.toString(),
      gasFeeAmount: gasFeeAmount.toString(),
      serviceFeeAmount: serviceFeeAmount.toString(),
      totalFeeAmount: totalFeeAmount.toString(),
      totalRequiredAmount: totalRequiredAmount.toString(),
      userBalance: "0",
      userBalanceFormatted: "unavailable",
      hasRegistryCode: false,
      hasRouterCode: false,
      hasAccountImplementationCode: false,
      hasTokenCode: false,
      isSupportedFeeToken: null,
      isSponsorAllowed: null,
      feePolicyAllowsAmounts: null,
      preflightStatus: "BLOCKED",
      recommendedAction: "BLOCK_CONTRACT_MISSING",
      note: buildNote([`Missing ${config.envPrefix}_RPC_URL; canary preflight skipped.`, config.note]),
    };
  }

  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  });
  const rpcChainId = await publicClient.getChainId();
  if (rpcChainId !== config.chainId) {
    throw new Error(`${config.envPrefix}_RPC_URL chainId mismatch: expected ${config.chainId}, got ${rpcChainId}`);
  }

  const [hasRegistryCode, hasRouterCode, hasAccountImplementationCode, hasTokenCode] = await Promise.all([
    safeGetCode(publicClient, registry),
    safeGetCode(publicClient, router),
    safeGetCode(publicClient, accountImplementation),
    safeGetCode(publicClient, config.tokenAddress),
  ]);
  const [onchainSymbol, decimals, userBalance] = await Promise.all([
    safeReadContract(() =>
      publicClient.readContract({
        address: config.tokenAddress,
        abi: ERC20_ABI,
        functionName: "symbol",
      }),
    ),
    safeReadContract(() =>
      publicClient.readContract({
        address: config.tokenAddress,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
    ),
    user === null
      ? Promise.resolve(undefined)
      : safeReadContract(() =>
          publicClient.readContract({
            address: config.tokenAddress,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [user],
          }),
        ),
  ]);
  const [registryRouter, feeReceiver, feePolicy, isSupportedFeeToken, isSponsorAllowed] =
    hasRegistryCode && registry !== null
      ? await Promise.all([
          safeReadContract(() =>
            publicClient.readContract({
              address: registry,
              abi: REGISTRY_ABI,
              functionName: "router",
            }),
          ),
          safeReadContract(() =>
            publicClient.readContract({
              address: registry,
              abi: REGISTRY_ABI,
              functionName: "feeReceiver",
            }),
          ),
          safeReadContract(() =>
            publicClient.readContract({
              address: registry,
              abi: REGISTRY_ABI,
              functionName: "feePolicy",
            }),
          ),
          safeReadContract(() =>
            publicClient.readContract({
              address: registry,
              abi: REGISTRY_ABI,
              functionName: "isSupportedFeeToken",
              args: [config.tokenAddress],
            }),
          ),
          sponsor === null
            ? Promise.resolve(undefined)
            : safeReadContract(() =>
                publicClient.readContract({
                  address: registry,
                  abi: REGISTRY_ABI,
                  functionName: "isSponsor",
                  args: [sponsor],
                }),
              ),
        ])
      : [undefined, undefined, undefined, undefined, undefined];
  const resolvedDecimals = decimals === undefined ? null : Number(decimals);
  const resolvedUserBalance = userBalance ?? 0n;
  const feePolicyOk = feePolicyAllowsAmounts(feePolicy, gasFeeAmount, serviceFeeAmount);
  const recommendedAction = chooseRecommendedAction({
    hasRegistryCode,
    hasRouterCode,
    hasAccountImplementationCode,
    hasTokenCode,
    decimals: resolvedDecimals,
    expectedDecimals: config.expectedDecimals,
    isSupportedFeeToken: isSupportedFeeToken ?? null,
    isSponsorAllowed: isSponsorAllowed ?? null,
    userBalance: resolvedUserBalance,
    totalRequiredAmount,
  });

  return {
    chainKey: config.chainKey,
    chainId: config.chainId,
    rpcChainId,
    tokenSymbol: config.tokenSymbol,
    tokenAddress: config.tokenAddress,
    onchainSymbol: onchainSymbol ?? "unavailable",
    decimals: resolvedDecimals,
    expectedDecimals: config.expectedDecimals,
    user,
    sponsor,
    router: registryRouter ?? router,
    registry,
    accountImplementation,
    feeReceiver: feeReceiver ?? null,
    feePolicy: feePolicy === undefined ? null : formatFeePolicy(feePolicy),
    paymentAmount: paymentAmount.toString(),
    gasFeeAmount: gasFeeAmount.toString(),
    serviceFeeAmount: serviceFeeAmount.toString(),
    totalFeeAmount: totalFeeAmount.toString(),
    totalRequiredAmount: totalRequiredAmount.toString(),
    userBalance: resolvedUserBalance.toString(),
    userBalanceFormatted:
      resolvedDecimals === null ? "unavailable" : formatUnits(resolvedUserBalance, resolvedDecimals),
    hasRegistryCode,
    hasRouterCode,
    hasAccountImplementationCode,
    hasTokenCode,
    isSupportedFeeToken: isSupportedFeeToken ?? null,
    isSponsorAllowed: isSponsorAllowed ?? null,
    feePolicyAllowsAmounts: feePolicyOk,
    preflightStatus: recommendedAction === "READY_FOR_MANUAL_CANARY" ? "PASS" : "BLOCKED",
    recommendedAction,
    note: buildNote([
      router !== null && registryRouter !== undefined && getAddress(router) !== getAddress(registryRouter)
        ? `Env router ${router} differs from registry.router ${registryRouter}.`
        : undefined,
      feePolicyOk === false
        ? "Configured gas/service fee amounts exceed registry feePolicy; adjust amounts before canary."
        : undefined,
      paymentAmount === 0n ? "Payment amount is 0; confirm whether this is intended before canary." : undefined,
      "This is preflight only; no transaction was broadcast and SDK verified flags were not changed.",
      config.note,
    ]),
  };
}

function buildMarkdownReport(rows: readonly CanaryPlanRow[]): string {
  const generatedAt = new Date().toISOString();
  const header = [
    "# Fee Token Canary Plan",
    "",
    `Generated at: ${generatedAt}`,
    "",
    "Read-only preflight. This report checks registry, router, account implementation, fee token code, whitelist state, sponsor allowlist, fee receiver, fee policy, and user token balance. It does not broadcast transactions and does not call registry write methods.",
    "",
    "| chainKey | chainId | tokenSymbol | tokenAddress | onchainSymbol | decimals | sponsor | router | registry | feeReceiver | paymentAmount | gasFeeAmount | serviceFeeAmount | totalRequiredAmount | userBalance | preflightStatus | recommendedAction |",
    "| --- | ---: | --- | --- | --- | ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
  ];
  const tableRows = rows.map((row) =>
    [
      row.chainKey,
      row.chainId,
      row.tokenSymbol,
      row.tokenAddress,
      row.onchainSymbol,
      row.decimals ?? "unavailable",
      row.sponsor ?? "missing",
      row.router ?? "missing",
      row.registry ?? "missing",
      row.feeReceiver ?? "unavailable",
      row.paymentAmount,
      row.gasFeeAmount,
      row.serviceFeeAmount,
      row.totalRequiredAmount,
      row.userBalance,
      row.preflightStatus,
      row.recommendedAction,
    ]
      .map(markdownEscape)
      .join(" | "),
  );
  const details = rows.map((row) =>
    [
      `## ${row.chainKey} ${row.tokenSymbol}`,
      "",
      `- user: \`${row.user ?? "missing"}\``,
      `- accountImplementation: \`${row.accountImplementation ?? "missing"}\``,
      `- expectedDecimals: \`${row.expectedDecimals}\``,
      `- isSupportedFeeToken: \`${row.isSupportedFeeToken ?? "unavailable"}\``,
      `- isSponsorAllowed: \`${row.isSponsorAllowed ?? "unavailable"}\``,
      `- feePolicyAllowsAmounts: \`${row.feePolicyAllowsAmounts ?? "unavailable"}\``,
      `- userBalanceFormatted: \`${row.userBalanceFormatted}\``,
      `- feePolicy: \`${row.feePolicy === null ? "unavailable" : JSON.stringify(row.feePolicy)}\``,
      `- note: ${row.note}`,
      "",
    ].join("\n"),
  );

  return `${header.join("\n")}\n${tableRows.map((row) => `| ${row} |`).join("\n")}\n\n${details.join("\n")}`;
}

function printSummary(rows: readonly CanaryPlanRow[]) {
  const readyRows = rows.filter((row) => row.recommendedAction === "READY_FOR_MANUAL_CANARY");
  const blockedRows = rows.filter((row) => row.recommendedAction !== "READY_FOR_MANUAL_CANARY");

  console.log("Fee token canary preflight completed.");
  console.log("");
  console.log("Ready for manual canary:");
  console.log(
    readyRows.length > 0
      ? readyRows
          .map((row) => `- ${row.chainKey} ${row.tokenSymbol}: totalRequired=${row.totalRequiredAmount}, balance=${row.userBalance}`)
          .join("\n")
      : "- none",
  );
  console.log("");
  console.log("Blocked:");
  console.log(
    blockedRows.length > 0
      ? blockedRows
          .map((row) => `- ${row.chainKey} ${row.tokenSymbol}: ${row.recommendedAction}`)
          .join("\n")
      : "- none",
  );
  console.log("");
  console.log(`Markdown report: ${REPORT_MD_PATH}`);
  console.log(`JSON report: ${REPORT_JSON_PATH}`);
}

async function main() {
  const rows = await Promise.all(CANARY_TOKEN_MATRIX.map(buildCanaryPlan));
  const markdown = buildMarkdownReport(rows);
  const json = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      warning:
        "Read-only canary preflight. Do not mark SDK verified=true until the manual canary transaction and reconciliation succeed.",
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
