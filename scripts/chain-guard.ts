// Guards shared by every script that writes to chain.
// Pure functions with no hardhat or network imports, so they are unit tested
// directly in test/ChainGuard.ts.

/**
 * Env prefix (as produced by envPrefix()) to the chainId that prefix must
 * resolve to. A script whose prefix is missing here refuses to write at all:
 * an unrecognised network is a configuration mistake, not a reason to guess.
 */
export const EXPECTED_CHAIN_IDS: Readonly<Record<string, number>> = {
  ETHEREUM: 1,
  BSC: 56,
  BSC_TESTNET: 97,
  ARBITRUM_ONE: 42161,
  POLYGON: 137,
  BASE: 8453,
  SEPOLIA: 11155111,
  BASE_SEPOLIA: 84532,
};

/**
 * Fails when --network points somewhere other than what the env prefix says.
 * Without this a wrong --network silently writes to the wrong chain, which is
 * unrecoverable once the transaction lands.
 */
export function assertExpectedChainId(prefix: string, chainId: number) {
  const expected = EXPECTED_CHAIN_IDS[prefix];
  if (expected === undefined) {
    throw new Error(`No expected chainId registered for env prefix ${prefix}; refusing to write`);
  }
  if (chainId !== expected) {
    throw new Error(`Expected ${prefix} chainId ${expected}, got ${chainId}`);
  }
}

/**
 * A run is a dry run when `--dry-run` is passed or the given env var is "true".
 * Hardhat 3 drops unknown CLI flags, so package.json wraps these commands in a
 * shell that turns the flag into the env var; both paths are honoured here.
 */
export function isDryRun(
  envVar: string,
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
) {
  return argv.includes("--dry-run") || env[envVar] === "true";
}

/**
 * Every registry mutation is onlyOwner. Checking before sending turns a wasted
 * on-chain revert into an immediate, explanatory failure.
 */
export function assertSignerIsOwner(owner: string, signer: string, action: string) {
  if (owner.toLowerCase() !== signer.toLowerCase()) {
    throw new Error(
      `Signer ${signer} is not the registry owner ${owner}. ` +
        `${action} is onlyOwner — configure the private key of the owner account.`,
    );
  }
}

/**
 * Refuses a run whose total fee is zero unless that was chosen on purpose.
 *
 * Sponsored7702Account._paySponsorFee returns early when the total fee is 0,
 * so a zero-fee call executes normally: the sponsor pays gas and receives
 * nothing back on chain. That is a legitimate mode — repayment can settle off
 * chain against a platform balance, including in a token on another chain —
 * but it must be a decision, not what happens when <CHAIN>_GAS_FEE_AMOUNT is
 * left at 0. Without this check the difference between "charging a fee" and
 * "giving gas away" is invisible at the call site.
 */
export function assertFeeIntent(totalFeeAmount: bigint, env: NodeJS.ProcessEnv = process.env) {
  if (totalFeeAmount === 0n && env.SPONSORED_ALLOW_ZERO_FEE !== "true") {
    throw new Error(
      "Total fee is 0, so this run would sponsor gas for free with no on-chain repayment. " +
        "Set <CHAIN>_GAS_FEE_AMOUNT to charge the user, " +
        "or set SPONSORED_ALLOW_ZERO_FEE=true to confirm the subsidy is intended.",
    );
  }
}

/**
 * Conservative gas estimate for one executeSponsored call.
 *
 * A single-transfer batch measured 146,496 gas on BSC Testnet and 158,848 on
 * Arbitrum One. The headroom is deliberate: this only decides whether to
 * attempt the run, and refusing a run that would have squeaked through is
 * cheaper than signing, sending and losing the gas to an out-of-funds revert.
 */
export function estimateSponsoredGasLimit(callCount: number) {
  return 180_000n + 80_000n * BigInt(callCount);
}

/**
 * Rejects a relayer that cannot cover the gas it is about to spend.
 *
 * <CHAIN>_RELAYER_MIN_NATIVE_BALANCE is an explicit floor, but it defaults to
 * 0, and a zero check alone passes a wallet holding dust. That combination let
 * a wallet with 0.0000012 ETH reach the signing step on Arbitrum One before
 * failing with "gas required exceeds allowance".
 *
 * `label` names the wallet being checked so failures identify the account
 * that must be funded.
 */
export function assertCanCoverGas(options: {
  label: string;
  address: string;
  balance: bigint;
  gasPrice: bigint;
  gasLimit: bigint;
  nativeSymbol: string;
}) {
  const required = options.gasPrice * options.gasLimit;
  if (options.balance < required) {
    throw new Error(
      `${options.label} ${options.nativeSymbol} balance cannot cover gas: ` +
        `balance=${options.balance}, estimated=${required} ` +
        `(${options.gasLimit} gas at ${options.gasPrice} wei). Fund ${options.address}.`,
    );
  }
}
