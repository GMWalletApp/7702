// Pure planning logic for the self-relayer canary.
// Kept free of child processes and network access so it can be unit tested.

export type CanaryTarget = {
  /** Stable id used by --only and in reports. */
  chainKey: string;
  /** Hardhat network name passed to --network. */
  network: string;
  /** Env prefix, as produced by envPrefix(). */
  envPrefix: string;
  tokenSymbol: string;
  /** Env key holding this token's address, e.g. "USDC_TOKEN_ADDRESS". */
  tokenEnvKey: string;
  /** Single-chain script this target reuses. */
  script: string;
  /** Fallback canary amount in base units when no env override is present. */
  defaultAmount: string;
  /** Spending here costs real money, so a live run needs --allow-mainnet. */
  isMainnet: boolean;
};

/**
 * Every (chain, fee token) pair the self-relayer path claims to support.
 * BSC Testnet appears twice because both of its tokens are whitelisted and a
 * canary that only exercised one would not catch a token-specific failure.
 */
export const CANARY_TARGETS: readonly CanaryTarget[] = [
  {
    chainKey: "bsc-testnet-usdt",
    network: "bscTestnet",
    envPrefix: "BSC_TESTNET",
    tokenSymbol: "USDT",
    tokenEnvKey: "USDT_TOKEN_ADDRESS",
    script: "scripts/bsc-testnet/run-sponsored-token-payment.ts",
    defaultAmount: "1000000000000000",
    isMainnet: false,
  },
  {
    chainKey: "bsc-testnet-usdc",
    network: "bscTestnet",
    envPrefix: "BSC_TESTNET",
    tokenSymbol: "USDC",
    tokenEnvKey: "USDC_TOKEN_ADDRESS",
    script: "scripts/bsc-testnet/run-sponsored-token-payment.ts",
    defaultAmount: "1000000000000000",
    isMainnet: false,
  },
  {
    chainKey: "arbitrum-one-usdc",
    network: "arbitrumOne",
    envPrefix: "ARBITRUM_ONE",
    tokenSymbol: "USDC",
    tokenEnvKey: "USDC_TOKEN_ADDRESS",
    script: "scripts/arbitrum-one/run-sponsored-token-payment.ts",
    defaultAmount: "1000",
    isMainnet: true,
  },
  {
    chainKey: "bsc-usdt",
    network: "bsc",
    envPrefix: "BSC",
    tokenSymbol: "USDT",
    tokenEnvKey: "USDT_TOKEN_ADDRESS",
    script: "scripts/bsc/run-sponsored-token-payment.ts",
    defaultAmount: "1000000000000000",
    isMainnet: true,
  },
  {
    chainKey: "ethereum-usdc",
    network: "ethereum",
    envPrefix: "ETHEREUM",
    tokenSymbol: "USDC",
    tokenEnvKey: "USDC_TOKEN_ADDRESS",
    script: "scripts/ethereum/run-sponsored-token-payment.ts",
    defaultAmount: "1000",
    isMainnet: true,
  },
  {
    chainKey: "polygon-usdc",
    network: "polygon",
    envPrefix: "POLYGON",
    tokenSymbol: "USDC",
    tokenEnvKey: "USDC_TOKEN_ADDRESS",
    script: "scripts/polygon/run-sponsored-token-payment.ts",
    defaultAmount: "1000",
    isMainnet: true,
  },
];

export function parseArgs(argv: readonly string[]) {
  const only = argv
    .filter((arg) => arg.startsWith("--only="))
    .flatMap((arg) => arg.slice("--only=".length).split(","))
    .map((key) => key.trim())
    .filter((key) => key.length > 0);

  return {
    dryRun: argv.includes("--dry-run"),
    allowMainnet: argv.includes("--allow-mainnet"),
    only,
  };
}

/**
 * Whether a live run may spend on this target.
 *
 * The canary spawns hardhat as a child process, so the per-command allow and
 * deny rules in .claude/settings.local.json never see the inner invocation —
 * they match the outer command string only. Without this gate one
 * `npm run canary:self-relayer` would walk straight past the mainnet block
 * those rules are there to enforce. Dry runs are unrestricted: they send
 * nothing, and previewing mainnet readiness is the point of the sweep.
 */
export function isTargetBlocked(target: CanaryTarget, dryRun: boolean, allowMainnet: boolean) {
  return target.isMainnet && !dryRun && !allowMainnet;
}

/** Applies --only, failing loudly on a key that matches nothing. */
export function selectTargets(targets: readonly CanaryTarget[], only: readonly string[]) {
  if (only.length === 0) {
    return targets;
  }

  const known = new Set(targets.map((target) => target.chainKey));
  const unknown = only.filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown --only target(s): ${unknown.join(", ")}. Known targets: ${[...known].join(", ")}`,
    );
  }

  return targets.filter((target) => only.includes(target.chainKey));
}

/**
 * Env overrides handed to the child run. The single-chain scripts read
 * FEE_TOKEN_ADDRESS and PAYMENT_AMOUNT through the per-chain-then-global
 * fallback, so setting the prefixed keys pins this one target without
 * disturbing the operator's .env.
 */
export function childEnvFor(
  target: CanaryTarget,
  tokenAddress: string,
  amount: string,
  dryRun: boolean,
): Record<string, string> {
  const overrides: Record<string, string> = {
    [`${target.envPrefix}_FEE_TOKEN_ADDRESS`]: tokenAddress,
    [`${target.envPrefix}_PAYMENT_AMOUNT`]: amount,
  };
  if (dryRun) {
    overrides.SPONSORED_DRY_RUN = "true";
  }

  return overrides;
}

/** Pulls the transaction hash out of a child run's stdout, if it sent one. */
export function extractTxHash(output: string): string | undefined {
  return /^tx: (0x[a-fA-F0-9]{64})$/m.exec(output)?.[1];
}

export type CanaryStatus = "passed" | "unconfirmed" | "failed";

/**
 * Classifies a finished run.
 *
 * "unconfirmed" exists because a child can send successfully and then lose
 * the RPC while waiting for the receipt — BSC's public node returns 403 under
 * load. Reporting that as a plain failure is a false negative that invites a
 * re-run, and a re-run spends again. A hash in the output means the
 * transaction is on its way and must be checked on chain, not resent.
 */
export function classifyResult(exitCode: number, txHash: string | undefined): CanaryStatus {
  if (exitCode === 0) {
    return "passed";
  }

  return txHash === undefined ? "failed" : "unconfirmed";
}

/**
 * Pulls the failure reason out of a child run's stderr.
 *
 * Takes the FIRST line, not the last: viem errors are multi-line and end with
 * "Version: viem@x.y.z", so reading from the end reports the library version
 * as the reason. The scripts print the real message first, then any hint.
 */
export function extractFailure(stderr: string): string | undefined {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("Hint:"));
}
