// Pure helpers for the self-relayer payment flow.
// No hardhat or network imports, so they can be unit tested directly.
import {
  concat,
  encodeAbiParameters,
  getAddress,
  hexToBigInt,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

const CALL_TYPEHASH = keccak256(new TextEncoder().encode("Call(address target,uint256 value,bytes32 dataHash)"));

/**
 * Sponsored7702Account stores its replay nonce in this ERC-7201-style slot.
 * Read the slot directly because an EOA may currently delegate to a different
 * EIP-7702 implementation whose getNonce() has unrelated semantics.
 */
export const SPONSORED_NONCE_STORAGE_SLOT =
  "0x88925b974227fac3545917acf2ff1490142a294cee7612791c3dc8128e942e00" as const;

export type Call = {
  target: Address;
  value: bigint;
  data: Hex;
};

export function hashCall(call: Call): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32,address,uint256,bytes32"), [
      CALL_TYPEHASH,
      call.target,
      call.value,
      keccak256(call.data),
    ]),
  );
}

export function hashCalls(calls: Call[]): Hex {
  return keccak256(concat(calls.map(hashCall)));
}

/** Decodes the account nonce while treating an untouched storage slot as 0. */
export function sponsoredNonceFromStorage(value: Hex | undefined) {
  return value === undefined || value === "0x" ? 0n : hexToBigInt(value);
}

/** Returns the target embedded in an EIP-7702 delegation designator. */
export function delegationTargetFromCode(code: Hex | undefined): Address | undefined {
  if (code === undefined || !/^0xef0100[0-9a-fA-F]{40}$/.test(code)) {
    return undefined;
  }
  return getAddress(`0x${code.slice(8)}`);
}

/**
 * A run is a dry run when `--dry-run` is passed or SPONSORED_DRY_RUN=true.
 * Matches the CLI and environment-variable gates used by relayer scripts.
 */
export function isDryRun(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env) {
  return argv.includes("--dry-run") || env.SPONSORED_DRY_RUN === "true";
}

/** Signs and simulates the complete request without broadcasting it. */
export function isSimulationOnly(env: NodeJS.ProcessEnv = process.env) {
  return env.SPONSORED_SIMULATE_ONLY === "true";
}

/** Rejects recipient/amount lists that would produce a malformed batch. */
export function assertPaymentInputs(recipients: readonly Address[], amounts: readonly bigint[]) {
  if (recipients.length === 0) {
    throw new Error("PAYMENT_RECIPIENTS must contain at least one address");
  }
  if (recipients.length !== amounts.length) {
    throw new Error(
      `PAYMENT_RECIPIENTS length ${recipients.length} must match PAYMENT_AMOUNTS length ${amounts.length}`,
    );
  }
  if (amounts.some((amount) => amount === 0n)) {
    throw new Error("All payment amounts must be greater than 0");
  }
}

/**
 * Token balance change expected for every address the batch touches.
 * Recipients may repeat, so amounts accumulate; when the fee receiver is also
 * a recipient its fee stacks on top of the payments it receives.
 */
export function expectedTokenDeltas(
  recipients: readonly Address[],
  amounts: readonly bigint[],
  feeReceiver: Address,
  totalFeeAmount: bigint,
): Map<Address, bigint> {
  const deltas = new Map<Address, bigint>();
  const add = (address: Address, amount: bigint) => {
    deltas.set(address, (deltas.get(address) ?? 0n) + amount);
  };

  recipients.forEach((recipient, index) => add(recipient, amounts[index]));
  if (totalFeeAmount > 0n) {
    add(feeReceiver, totalFeeAmount);
  }

  return deltas;
}

/**
 * Fee token Transfer logs the transaction must emit: one per call, plus one
 * for the fee when a fee is charged.
 */
export function expectedTransferLogCount(callCount: number, totalFeeAmount: bigint) {
  return callCount + (totalFeeAmount > 0n ? 1 : 0);
}

/**
 * Post-execution log assertions. The account contract returns early from
 * _paySponsorFee when the total fee is zero, so no FeePaid event is emitted
 * in that case.
 */
export function assertEventCounts(counts: {
  forwarded: number;
  feePaid: number;
  transfers: number;
  callCount: number;
  totalFeeAmount: bigint;
}) {
  if (counts.forwarded !== 1) {
    throw new Error(`Expected exactly 1 SponsoredCallForwarded log, got ${counts.forwarded}`);
  }
  if (counts.totalFeeAmount > 0n && counts.feePaid !== 1) {
    throw new Error(`Expected exactly 1 FeePaid log, got ${counts.feePaid}`);
  }
  if (counts.totalFeeAmount === 0n && counts.feePaid !== 0) {
    throw new Error(`Expected no FeePaid log when the total fee is zero, got ${counts.feePaid}`);
  }

  const expected = expectedTransferLogCount(counts.callCount, counts.totalFeeAmount);
  if (counts.transfers < expected) {
    throw new Error(`Expected at least ${expected} fee token Transfer logs, got ${counts.transfers}`);
  }
}

/**
 * Runs a script body and turns a failure into one clean line plus a hint.
 *
 * Scripts that use top-level await cannot wrap themselves without indenting
 * their whole body, and an uncaught throw reaches Hardhat, which prints a
 * stack trace and a "report a bug" footer over what is usually a
 * configuration mistake. Splitting the body into a sibling `.impl.ts` and
 * importing it from here keeps the body untouched and the output readable.
 */
export async function runScript(load: () => Promise<unknown>) {
  try {
    await load();
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

/** Maps a failure message to an actionable next step. */
export function troubleshootingHint(text: string): string | undefined {
  if (/is not allowed in registry/.test(text)) {
    return "Whitelist the sponsor first — run `npm run configure:<chain>` with SPONSOR_ADDRESS set to your wallet.";
  }
  if (/is not supported in registry/.test(text)) {
    return "Add the fee token via setSupportedFeeToken, e.g. `npm run configure:<chain>`.";
  }
  if (/is paused/.test(text)) {
    return "The registry owner must call unpause() before sponsored execution works again.";
  }
  // Native and token shortfalls need different fixes, so keep them apart.
  // The sponsor pays gas in the native currency; the user pays the transfer
  // and the fee in the ERC-20.
  if (/SPONSOR_ADDRESS .* balance is too low/.test(text)) {
    return "Fund the sponsor with more native currency, or lower <CHAIN>_RELAYER_MIN_NATIVE_BALANCE.";
  }
  if (/has no .* for gas|has no .* for self execution gas/.test(text)) {
    return "The account holds zero native currency and cannot pay gas. Fund it first.";
  }
  if (/USER_ADDRESS .* balance is too low/.test(text)) {
    return "Fund the user with more of the fee token, or lower <CHAIN>_PAYMENT_AMOUNT / <CHAIN>_GAS_FEE_AMOUNT.";
  }
  if (/has no contract code/.test(text)) {
    return "The address points at an empty account — check you are on the intended network.";
  }
  if (/Missing required environment variable/.test(text)) {
    return "Compare your .env against .env.example; per-chain keys fall back to the global key.";
  }

  return undefined;
}
