import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAddress, type Address } from "viem";

import {
  assertEventCounts,
  assertPaymentInputs,
  delegationTargetFromCode,
  expectedTokenDeltas,
  expectedTransferLogCount,
  hashCalls,
  isDryRun,
  isSimulationOnly,
  SPONSORED_NONCE_STORAGE_SLOT,
  sponsoredNonceFromStorage,
  troubleshootingHint,
} from "../scripts/sponsored-payment-checks.js";

const ALICE = getAddress("0x1111111111111111111111111111111111111111");
const BOB = getAddress("0x2222222222222222222222222222222222222222");
const FEE_RECEIVER = getAddress("0x3333333333333333333333333333333333333333");
const TOKEN = getAddress("0x4444444444444444444444444444444444444444");

const call = (target: Address, data: `0x${string}`) => ({ target, value: 0n, data });

describe("dry run detection", function () {
  it("triggers on the --dry-run flag", function () {
    assert.equal(isDryRun(["node", "script", "--dry-run"], {}), true);
  });

  it("triggers on SPONSORED_DRY_RUN=true", function () {
    assert.equal(isDryRun(["node", "script"], { SPONSORED_DRY_RUN: "true" }), true);
  });

  it("stays off without either signal", function () {
    assert.equal(isDryRun(["node", "script"], {}), false);
    assert.equal(isDryRun(["node", "script"], { SPONSORED_DRY_RUN: "false" }), false);
    assert.equal(isDryRun(["node", "script", "--dry"], {}), false);
  });
});

describe("signed simulation detection", function () {
  it("requires an exact explicit opt-in", function () {
    assert.equal(isSimulationOnly({ SPONSORED_SIMULATE_ONLY: "true" }), true);
    assert.equal(isSimulationOnly({}), false);
    assert.equal(isSimulationOnly({ SPONSORED_SIMULATE_ONLY: "false" }), false);
    assert.equal(isSimulationOnly({ SPONSORED_SIMULATE_ONLY: "1" }), false);
  });
});

describe("payment input validation", function () {
  it("accepts matching recipients and positive amounts", function () {
    assert.doesNotThrow(() => assertPaymentInputs([ALICE, BOB], [1n, 2n]));
  });

  it("rejects an empty recipient list", function () {
    assert.throws(() => assertPaymentInputs([], []), /at least one address/);
  });

  it("rejects a length mismatch", function () {
    assert.throws(() => assertPaymentInputs([ALICE, BOB], [1n]), /must match PAYMENT_AMOUNTS length/);
  });

  it("rejects a zero amount", function () {
    assert.throws(() => assertPaymentInputs([ALICE, BOB], [1n, 0n]), /greater than 0/);
  });
});

describe("expected token deltas", function () {
  it("adds the fee on top of the recipient payments", function () {
    const deltas = expectedTokenDeltas([ALICE, BOB], [10n, 20n], FEE_RECEIVER, 5n);
    assert.equal(deltas.get(ALICE), 10n);
    assert.equal(deltas.get(BOB), 20n);
    assert.equal(deltas.get(FEE_RECEIVER), 5n);
  });

  it("accumulates when the same recipient is paid twice", function () {
    const deltas = expectedTokenDeltas([ALICE, ALICE], [10n, 20n], FEE_RECEIVER, 0n);
    assert.equal(deltas.get(ALICE), 30n);
    assert.equal(deltas.size, 1);
  });

  it("stacks the fee when the fee receiver is also a recipient", function () {
    const deltas = expectedTokenDeltas([FEE_RECEIVER], [10n], FEE_RECEIVER, 5n);
    assert.equal(deltas.get(FEE_RECEIVER), 15n);
  });

  it("omits the fee receiver when no fee is charged", function () {
    const deltas = expectedTokenDeltas([ALICE], [10n], FEE_RECEIVER, 0n);
    assert.equal(deltas.has(FEE_RECEIVER), false);
  });
});

describe("expected transfer log count", function () {
  it("counts one log per call plus one for the fee", function () {
    assert.equal(expectedTransferLogCount(3, 5n), 4);
  });

  it("counts only the calls when the fee is zero", function () {
    assert.equal(expectedTransferLogCount(3, 0n), 3);
  });
});

describe("event count assertions", function () {
  const ok = { forwarded: 1, feePaid: 1, transfers: 3, callCount: 2, totalFeeAmount: 5n };

  it("accepts a well formed sponsored execution", function () {
    assert.doesNotThrow(() => assertEventCounts(ok));
  });

  it("accepts extra transfer logs from unrelated calls in the batch", function () {
    assert.doesNotThrow(() => assertEventCounts({ ...ok, transfers: 9 }));
  });

  it("rejects a missing or duplicated router forward", function () {
    assert.throws(() => assertEventCounts({ ...ok, forwarded: 0 }), /exactly 1 SponsoredCallForwarded/);
    assert.throws(() => assertEventCounts({ ...ok, forwarded: 2 }), /exactly 1 SponsoredCallForwarded/);
  });

  it("requires exactly one FeePaid when a fee is charged", function () {
    assert.throws(() => assertEventCounts({ ...ok, feePaid: 0 }), /exactly 1 FeePaid/);
    assert.throws(() => assertEventCounts({ ...ok, feePaid: 2 }), /exactly 1 FeePaid/);
  });

  it("requires no FeePaid when the total fee is zero", function () {
    assert.doesNotThrow(() => assertEventCounts({ ...ok, feePaid: 0, transfers: 2, totalFeeAmount: 0n }));
    assert.throws(
      () => assertEventCounts({ ...ok, feePaid: 1, transfers: 2, totalFeeAmount: 0n }),
      /no FeePaid log when the total fee is zero/,
    );
  });

  it("rejects fewer transfer logs than the batch requires", function () {
    assert.throws(() => assertEventCounts({ ...ok, transfers: 2 }), /at least 3 fee token Transfer logs/);
  });
});

describe("calls hashing", function () {
  it("is deterministic for the same batch", function () {
    const calls = [call(TOKEN, "0xdeadbeef"), call(TOKEN, "0xfeedface")];
    assert.equal(hashCalls(calls), hashCalls([...calls]));
  });

  it("changes when the call order changes", function () {
    const a = call(TOKEN, "0xdeadbeef");
    const b = call(TOKEN, "0xfeedface");
    assert.notEqual(hashCalls([a, b]), hashCalls([b, a]));
  });

  it("changes when any field changes", function () {
    const base = call(TOKEN, "0xdeadbeef");
    assert.notEqual(hashCalls([base]), hashCalls([{ ...base, data: "0xdeadbeee" }]));
    assert.notEqual(hashCalls([base]), hashCalls([{ ...base, value: 1n }]));
    assert.notEqual(hashCalls([base]), hashCalls([{ ...base, target: ALICE }]));
  });
});

describe("delegated account state", function () {
  it("reads the sponsored nonce from the fixed account storage slot", function () {
    assert.equal(SPONSORED_NONCE_STORAGE_SLOT.length, 66);
    assert.equal(sponsoredNonceFromStorage(undefined), 0n);
    assert.equal(sponsoredNonceFromStorage("0x"), 0n);
    assert.equal(sponsoredNonceFromStorage("0x01"), 1n);
    assert.equal(sponsoredNonceFromStorage("0x0100"), 256n);
  });

  it("extracts only a valid EIP-7702 delegation target", function () {
    assert.equal(delegationTargetFromCode(undefined), undefined);
    assert.equal(delegationTargetFromCode("0x"), undefined);
    assert.equal(delegationTargetFromCode("0x6000"), undefined);
    assert.equal(delegationTargetFromCode(`0xef0100${ALICE.slice(2)}`), ALICE);
  });
});

describe("troubleshooting hints", function () {
  it("points at the configure script for registry rejections", function () {
    assert.match(
      troubleshootingHint("SPONSOR_ADDRESS is not allowed in registry: 0x1") ?? "",
      /configure:<chain>/,
    );
  });

  it("points at unpause when the registry is paused", function () {
    assert.match(
      troubleshootingHint("SponsorPolicyRegistry is paused; sponsored execution is disabled") ?? "",
      /unpause\(\)/,
    );
  });

  it("points at .env when a variable is missing", function () {
    assert.match(troubleshootingHint("Missing required environment variable: BSC_RPC_URL") ?? "", /\.env\.example/);
  });

  it("tells a token shortfall apart from a native one", function () {
    // The sponsor pays gas in native currency; the user pays in the ERC-20.
    // Sending someone to top up the wrong balance wastes a round trip.
    assert.match(
      troubleshootingHint("USER_ADDRESS USDC balance is too low: balance=54000, required=100000") ?? "",
      /fee token/,
    );
    assert.match(
      troubleshootingHint("SPONSOR_ADDRESS ETH balance is too low: balance=1, required=2") ?? "",
      /native currency.*RELAYER_MIN_NATIVE_BALANCE/,
    );
  });

  it("flags a zero native balance as unable to pay gas at all", function () {
    assert.match(
      troubleshootingHint("SPONSOR_ADDRESS has no BNB for gas: 0x1") ?? "",
      /zero native currency/,
    );
    assert.match(
      troubleshootingHint("USER_ADDRESS has no Arbitrum ETH for self execution gas: 0x1") ?? "",
      /zero native currency/,
    );
  });

  it("returns nothing for an unrecognised failure", function () {
    assert.equal(troubleshootingHint("some unrelated explosion"), undefined);
  });
});
