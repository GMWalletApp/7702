import "dotenv/config";

import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
} from "viem";

type ChainKey = "ethereum" | "bsc" | "bscTestnet" | "arbitrumOne" | "polygon";

type ImmutableReference = {
  start: number;
  length: number;
};

export type ImmutableReferences = Record<string, readonly ImmutableReference[]>;

type PinnedContract = {
  address: Address;
  runtimeCodeHash: Hex;
};

type ExpectedFeePolicy = {
  maxGasFeeAmount: bigint;
  maxServiceFeeAmount: bigint;
  maxTotalFeeAmount: bigint;
  maxCalls: bigint;
};

type ChainConfig = {
  chainKey: ChainKey;
  chainId: number;
  rpcEnv: string;
  deploymentArtifact: string;
  buildProfile: "default" | "production";
  policyRegistry: PinnedContract;
  accountImplementation: PinnedContract;
  sponsorRouter: PinnedContract;
  sponsor: Address;
  feeToken: Address;
  expectedFeePolicy: ExpectedFeePolicy;
};

type ContractCheck = {
  address: Address;
  hasCode: boolean;
  runtimeCodeMatchesPinnedDeployment: boolean;
  expectedRuntimeCodeHash: Hex;
  actualRuntimeCodeHash: Hex | null;
};

type RegistryCheck = {
  routerMatches: boolean;
  accountRegistryMatches: boolean;
  routerRegistryMatches: boolean;
  paused: boolean;
  sponsorAllowed: boolean;
  feeTokenAllowed: boolean;
  feePolicyMatches: boolean;
  maxGasFeeAmount: string;
  maxServiceFeeAmount: string;
  maxTotalFeeAmount: string;
  maxCalls: string;
};

export type FiveChainDeploymentCheck = {
  chainKey: ChainKey;
  expectedChainId: number;
  rpcChainId: number | null;
  deploymentArtifact: string;
  buildProfile: "default" | "production";
  policyRegistry: ContractCheck | null;
  accountImplementation: ContractCheck | null;
  sponsorRouter: ContractCheck | null;
  registry: RegistryCheck | null;
  passed: boolean;
  notes: string[];
};

const PURE_SUBSIDY_POLICY: ExpectedFeePolicy = {
  maxGasFeeAmount: 0n,
  maxServiceFeeAmount: 0n,
  maxTotalFeeAmount: 0n,
  maxCalls: 10n,
};

/**
 * Approved deployment manifest.
 *
 * Runtime code hashes are pinned per deployed address instead of being
 * derived from the mutable local artifacts directory. The first four chains
 * were deployed with the default profile; Polygon was deployed with the
 * production profile. Switching compiler profiles locally must never turn a
 * healthy production deployment into a false bytecode mismatch.
 */
const CHAINS: readonly ChainConfig[] = [
  {
    chainKey: "ethereum",
    chainId: 1,
    rpcEnv: "ETHEREUM_RPC_URL",
    deploymentArtifact: "four-chain-contract-acceptance-2026-07-28",
    buildProfile: "default",
    policyRegistry: {
      address: "0xd78bB282F808d497004Ca902ff5E345D02E2df01",
      runtimeCodeHash: "0xc7752c2dc2fa812ab1eb525b39753cb2a6384a830825d80dfa25a6f5ad8046ab",
    },
    accountImplementation: {
      address: "0x7E6bC54553c5b2D83C03e115E9Cf6c5F20B3BE76",
      runtimeCodeHash: "0xfe83ccd7b2c50ac2938967e5ea3bc34845ef17ec009ef96d653318d812042d8f",
    },
    sponsorRouter: {
      address: "0x0f9B7AA2138BfE40f169fB13D286FFe2eC724734",
      runtimeCodeHash: "0xebf45fc123f7df3225456874cadc9f7c35c606cc36c5f74589115815d911ff87",
    },
    sponsor: "0x695E586c5F5034dA8854924fA1Ab4C3f063D012A",
    feeToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    expectedFeePolicy: PURE_SUBSIDY_POLICY,
  },
  {
    chainKey: "bsc",
    chainId: 56,
    rpcEnv: "BSC_RPC_URL",
    deploymentArtifact: "four-chain-contract-acceptance-2026-07-28",
    buildProfile: "default",
    policyRegistry: {
      address: "0xabeA8fF5e60FFe326ba431113b9EEeC70Dcfb8Be",
      runtimeCodeHash: "0xc7752c2dc2fa812ab1eb525b39753cb2a6384a830825d80dfa25a6f5ad8046ab",
    },
    accountImplementation: {
      address: "0x1f62534e8b753033e02fF579D4eC6231B6645aBc",
      runtimeCodeHash: "0x1aee767a32a3f7f2778d136e6c845c204c3935e6ccd2dfc64ed2a63258f05101",
    },
    sponsorRouter: {
      address: "0x55A6fA528aeBABF6C81FD2C7F0CC48D2C464513A",
      runtimeCodeHash: "0x28f94e9dc634952b808fdc63d46710d46ff6cc0cb8a1884f38c63efeed292d21",
    },
    sponsor: "0x695E586c5F5034dA8854924fA1Ab4C3f063D012A",
    feeToken: "0x55d398326f99059fF775485246999027B3197955",
    expectedFeePolicy: PURE_SUBSIDY_POLICY,
  },
  {
    chainKey: "bscTestnet",
    chainId: 97,
    rpcEnv: "BSC_TESTNET_RPC_URL",
    deploymentArtifact: "four-chain-contract-acceptance-2026-07-28",
    buildProfile: "default",
    policyRegistry: {
      address: "0x3de7144eF55D28682302F99Fa06374057920E25B",
      runtimeCodeHash: "0xc7752c2dc2fa812ab1eb525b39753cb2a6384a830825d80dfa25a6f5ad8046ab",
    },
    accountImplementation: {
      address: "0xa681A026D984Ac6B028984008B7A0a8512FAfAB7",
      runtimeCodeHash: "0x6b5236f4e7c10eaf7af1d1b3d0a0e2a3980aed08595d0f3116b6197f2b2e2c8e",
    },
    sponsorRouter: {
      address: "0x0F49dB4dED328b19317265bDB60dFC54ab2c0dDc",
      runtimeCodeHash: "0x3a09321f23daacb4d01d7467e1922d614507f19e25aec49850ae364b0150549a",
    },
    sponsor: "0x695E586c5F5034dA8854924fA1Ab4C3f063D012A",
    feeToken: "0x40bFfb4A97B0d67735Cd2869c17DeD190C3B3028",
    expectedFeePolicy: PURE_SUBSIDY_POLICY,
  },
  {
    chainKey: "arbitrumOne",
    chainId: 42161,
    rpcEnv: "ARBITRUM_ONE_RPC_URL",
    deploymentArtifact: "four-chain-contract-acceptance-2026-07-28",
    buildProfile: "default",
    policyRegistry: {
      address: "0xabeA8fF5e60FFe326ba431113b9EEeC70Dcfb8Be",
      runtimeCodeHash: "0xc7752c2dc2fa812ab1eb525b39753cb2a6384a830825d80dfa25a6f5ad8046ab",
    },
    accountImplementation: {
      address: "0x1f62534e8b753033e02fF579D4eC6231B6645aBc",
      runtimeCodeHash: "0xa9f3c4de35987243fbaf48da0c052a4b1a9a2c352ff9b21ed2a32292543f83f0",
    },
    sponsorRouter: {
      address: "0x0f9B7AA2138BfE40f169fB13D286FFe2eC724734",
      runtimeCodeHash: "0x28f94e9dc634952b808fdc63d46710d46ff6cc0cb8a1884f38c63efeed292d21",
    },
    sponsor: "0x695E586c5F5034dA8854924fA1Ab4C3f063D012A",
    feeToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    expectedFeePolicy: PURE_SUBSIDY_POLICY,
  },
  {
    chainKey: "polygon",
    chainId: 137,
    rpcEnv: "POLYGON_RPC_URL",
    deploymentArtifact: "chain-137-router-v2",
    buildProfile: "production",
    policyRegistry: {
      address: "0xabeA8fF5e60FFe326ba431113b9EEeC70Dcfb8Be",
      runtimeCodeHash: "0xcea4335abac4f98d20ebf3cde6325db470839fce7e1d09481ecea86fa0760b19",
    },
    accountImplementation: {
      address: "0x1f62534e8b753033e02fF579D4eC6231B6645aBc",
      runtimeCodeHash: "0x96d6909baab72203fe490ac06bcfae267a43bb506c64f6cc70aee23110081d6d",
    },
    sponsorRouter: {
      address: "0x9d4Fbb71886d6FC55239563D92ac7054d63afF27",
      runtimeCodeHash: "0xff83335a21591161f0aed1066c7b5224074bf282ed613a6f03c2a82d6e554f18",
    },
    sponsor: "0x695E586c5F5034dA8854924fA1Ab4C3f063D012A",
    feeToken: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    expectedFeePolicy: PURE_SUBSIDY_POLICY,
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
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
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
] as const;

const POLICY_REGISTRY_BINDING_ABI = [
  {
    type: "function",
    name: "policyRegistry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

function stripSolidityMetadata(bytecode: Hex): Hex {
  const body = bytecode.slice(2);
  if (body.length < 4) return bytecode;

  const metadataLength = Number.parseInt(body.slice(-4), 16);
  const metadataStart = body.length - 4 - metadataLength * 2;
  if (!Number.isSafeInteger(metadataLength) || metadataStart < 0 || metadataStart >= body.length - 4) {
    return bytecode;
  }

  const firstMetadataByte = Number.parseInt(body.slice(metadataStart, metadataStart + 2), 16);
  if ((firstMetadataByte & 0xe0) !== 0xa0) return bytecode;

  return `0x${body.slice(0, metadataStart)}`;
}

// Kept as a public utility for deployment-report verification and its unit
// tests. The live preflight intentionally uses exact pinned runtime hashes.
export function normalizeDeployedBytecode(
  bytecode: Hex,
  immutableReferences: ImmutableReferences,
): Hex {
  if (bytecode === "0x") return bytecode;

  const bytes = bytecode.slice(2).split("");
  for (const references of Object.values(immutableReferences)) {
    for (const reference of references) {
      const start = reference.start * 2;
      const end = start + reference.length * 2;
      if (start < 0 || end > bytes.length) {
        throw new Error(`Immutable reference ${reference.start}:${reference.length} exceeds bytecode length`);
      }
      bytes.fill("0", start, end);
    }
  }

  return stripSolidityMetadata(`0x${bytes.join("")}`);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

async function checkContract(
  client: ReturnType<typeof createPublicClient>,
  contract: PinnedContract,
): Promise<ContractCheck> {
  const code = (await client.getCode({ address: contract.address })) ?? "0x";
  const actualRuntimeCodeHash = code === "0x" ? null : keccak256(code);

  return {
    address: contract.address,
    hasCode: code !== "0x",
    runtimeCodeMatchesPinnedDeployment: actualRuntimeCodeHash === contract.runtimeCodeHash,
    expectedRuntimeCodeHash: contract.runtimeCodeHash,
    actualRuntimeCodeHash,
  };
}

async function inspectChain(config: ChainConfig): Promise<FiveChainDeploymentCheck> {
  const result: FiveChainDeploymentCheck = {
    chainKey: config.chainKey,
    expectedChainId: config.chainId,
    rpcChainId: null,
    deploymentArtifact: config.deploymentArtifact,
    buildProfile: config.buildProfile,
    policyRegistry: null,
    accountImplementation: null,
    sponsorRouter: null,
    registry: null,
    passed: false,
    notes: [],
  };

  try {
    const client = createPublicClient({
      transport: http(requiredEnv(config.rpcEnv), { timeout: 20_000 }),
    });

    result.rpcChainId = await client.getChainId();
    if (result.rpcChainId !== config.chainId) {
      result.notes.push(`RPC chain ID mismatch: expected ${config.chainId}, got ${result.rpcChainId}`);
    }

    const [registryContract, accountContract, routerContract] = await Promise.all([
      checkContract(client, config.policyRegistry),
      checkContract(client, config.accountImplementation),
      checkContract(client, config.sponsorRouter),
    ]);
    result.policyRegistry = registryContract;
    result.accountImplementation = accountContract;
    result.sponsorRouter = routerContract;

    const [configuredRouter, paused, sponsorAllowed, feeTokenAllowed, feePolicy, accountRegistry, routerRegistry] =
      await Promise.all([
        client.readContract({ address: config.policyRegistry.address, abi: REGISTRY_ABI, functionName: "router" }),
        client.readContract({ address: config.policyRegistry.address, abi: REGISTRY_ABI, functionName: "paused" }),
        client.readContract({
          address: config.policyRegistry.address,
          abi: REGISTRY_ABI,
          functionName: "isSponsor",
          args: [config.sponsor],
        }),
        client.readContract({
          address: config.policyRegistry.address,
          abi: REGISTRY_ABI,
          functionName: "isSupportedFeeToken",
          args: [config.feeToken],
        }),
        client.readContract({ address: config.policyRegistry.address, abi: REGISTRY_ABI, functionName: "feePolicy" }),
        client.readContract({
          address: config.accountImplementation.address,
          abi: POLICY_REGISTRY_BINDING_ABI,
          functionName: "policyRegistry",
        }),
        client.readContract({
          address: config.sponsorRouter.address,
          abi: POLICY_REGISTRY_BINDING_ABI,
          functionName: "policyRegistry",
        }),
      ]);

    const feePolicyMatches =
      feePolicy.maxGasFeeAmount === config.expectedFeePolicy.maxGasFeeAmount &&
      feePolicy.maxServiceFeeAmount === config.expectedFeePolicy.maxServiceFeeAmount &&
      feePolicy.maxTotalFeeAmount === config.expectedFeePolicy.maxTotalFeeAmount &&
      feePolicy.maxCalls === config.expectedFeePolicy.maxCalls;

    result.registry = {
      routerMatches: getAddress(configuredRouter) === getAddress(config.sponsorRouter.address),
      accountRegistryMatches: getAddress(accountRegistry) === getAddress(config.policyRegistry.address),
      routerRegistryMatches: getAddress(routerRegistry) === getAddress(config.policyRegistry.address),
      paused,
      sponsorAllowed,
      feeTokenAllowed,
      feePolicyMatches,
      maxGasFeeAmount: feePolicy.maxGasFeeAmount.toString(),
      maxServiceFeeAmount: feePolicy.maxServiceFeeAmount.toString(),
      maxTotalFeeAmount: feePolicy.maxTotalFeeAmount.toString(),
      maxCalls: feePolicy.maxCalls.toString(),
    };

    const contractChecks = [registryContract, accountContract, routerContract];
    for (const [label, check] of [
      ["policy registry", registryContract],
      ["account implementation", accountContract],
      ["sponsor router", routerContract],
    ] as const) {
      if (!check.hasCode) {
        result.notes.push(`${label} has no deployed code`);
      } else if (!check.runtimeCodeMatchesPinnedDeployment) {
        result.notes.push(`${label} runtime code does not match the pinned deployment manifest`);
      }
    }
    if (!result.registry.routerMatches) result.notes.push("registry.router does not match the pinned sponsor router");
    if (!result.registry.accountRegistryMatches) result.notes.push("account implementation points to another registry");
    if (!result.registry.routerRegistryMatches) result.notes.push("sponsor router points to another registry");
    if (result.registry.paused) result.notes.push("registry is paused");
    if (!result.registry.sponsorAllowed) result.notes.push("self sponsor is not allowlisted");
    if (!result.registry.feeTokenAllowed) result.notes.push("pinned fee token is not allowlisted");
    if (!result.registry.feePolicyMatches) {
      result.notes.push(
        `fee policy is not pure subsidy 0/0/0/${config.expectedFeePolicy.maxCalls.toString()}`,
      );
    }

    result.passed =
      result.rpcChainId === config.chainId &&
      contractChecks.every((check) => check.hasCode && check.runtimeCodeMatchesPinnedDeployment) &&
      result.registry.routerMatches &&
      result.registry.accountRegistryMatches &&
      result.registry.routerRegistryMatches &&
      !result.registry.paused &&
      result.registry.sponsorAllowed &&
      result.registry.feeTokenAllowed &&
      result.registry.feePolicyMatches;
  } catch (error) {
    result.notes.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

function summaryRow(result: FiveChainDeploymentCheck) {
  return {
    chain: result.chainKey,
    chainId: result.rpcChainId ?? "error",
    profile: result.buildProfile,
    registryCode: result.policyRegistry?.hasCode ?? false,
    registryMatch: result.policyRegistry?.runtimeCodeMatchesPinnedDeployment ?? false,
    accountCode: result.accountImplementation?.hasCode ?? false,
    accountMatch: result.accountImplementation?.runtimeCodeMatchesPinnedDeployment ?? false,
    routerCode: result.sponsorRouter?.hasCode ?? false,
    routerMatch: result.sponsorRouter?.runtimeCodeMatchesPinnedDeployment ?? false,
    policyMatch: result.registry?.feePolicyMatches ?? false,
    passed: result.passed,
    notes: result.notes.join("; "),
  };
}

export async function runFiveChainDeploymentPreflight(): Promise<FiveChainDeploymentCheck[]> {
  return Promise.all(CHAINS.map((config) => inspectChain(config)));
}

export async function runFiveChainDeploymentPreflightCli() {
  const results = await runFiveChainDeploymentPreflight();
  console.table(results.map(summaryRow));
  console.log(JSON.stringify(results, null, 2));

  if (results.some((result) => !result.passed)) {
    process.exitCode = 1;
  }
}

// Backward-compatible exports for callers that have not migrated command
// names yet. They now inspect the same five-chain deployment manifest.
export const runFourChainDeploymentPreflight = runFiveChainDeploymentPreflight;
export const runFourChainDeploymentPreflightCli = runFiveChainDeploymentPreflightCli;
