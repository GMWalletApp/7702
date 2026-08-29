import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXPECTED_CHAIN_IDS,
  assertCanCoverGas,
  assertExpectedChainId,
  assertFeeIntent,
  assertSignerIsOwner,
  estimateSponsoredGasLimit,
  isDryRun,
} from "../scripts/chain-guard.js";

describe("expected chain id guard", function () {
  it("accepts a matching prefix and chainId", function () {
    assert.doesNotThrow(() => assertExpectedChainId("BSC_TESTNET", 97));
    assert.doesNotThrow(() => assertExpectedChainId("ETHEREUM", 1));
    assert.doesNotThrow(() => assertExpectedChainId("ARBITRUM_ONE", 42161));
  });

  it("rejects a chainId the prefix does not map to", function () {
    assert.throws(() => assertExpectedChainId("ETHEREUM", 56), /Expected ETHEREUM chainId 1, got 56/);
  });

  it("refuses to write on an unregistered prefix rather than guessing", function () {
    assert.throws(() => assertExpectedChainId("SOME_NEW_CHAIN", 1234), /refusing to write/);
  });

  it("never maps two prefixes to the same chainId", function () {
    const ids = Object.values(EXPECTED_CHAIN_IDS);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("catches the mainnet/testnet pairs that are easiest to confuse", function () {
    assert.throws(() => assertExpectedChainId("BSC", 97), /Expected BSC chainId 56/);
    assert.throws(() => assertExpectedChainId("BSC_TESTNET", 56), /Expected BSC_TESTNET chainId 97/);
    assert.throws(() => assertExpectedChainId("BASE", 84532), /Expected BASE chainId 8453/);
  });
});

describe("dry run detection", function () {
  it("triggers on the --dry-run flag regardless of env var name", function () {
    assert.equal(isDryRun("ANY_VAR", ["node", "s", "--dry-run"], {}), true);
  });

  it("triggers on the named env var being exactly true", function () {
    assert.equal(isDryRun("SPONSOR_DRY_RUN", ["node", "s"], { SPONSOR_DRY_RUN: "true" }), true);
  });

  it("ignores a different script's dry run var", function () {
    assert.equal(isDryRun("SPONSOR_DRY_RUN", ["node", "s"], { SPONSORED_DRY_RUN: "true" }), false);
  });

  it("stays off for absent, false, or near-miss values", function () {
    assert.equal(isDryRun("V", ["node", "s"], {}), false);
    assert.equal(isDryRun("V", ["node", "s"], { V: "false" }), false);
    assert.equal(isDryRun("V", ["node", "s"], { V: "1" }), false);
    assert.equal(isDryRun("V", ["node", "s", "--dry"], {}), false);
  });
});

describe("zero fee guard", function () {
  it("accepts any non-zero fee without a flag", function () {
    assert.doesNotThrow(() => assertFeeIntent(1n, {}));
  });

  it("rejects a zero fee that nobody asked for", function () {
    // Leaving <CHAIN>_GAS_FEE_AMOUNT at 0 turns sponsorship into a giveaway,
    // and the contract executes it happily because _paySponsorFee returns
    // early on a zero total.
    assert.throws(() => assertFeeIntent(0n, {}), /sponsor gas for free/);
  });

  it("allows a zero fee once the subsidy is confirmed", function () {
    assert.doesNotThrow(() => assertFeeIntent(0n, { SPONSORED_ALLOW_ZERO_FEE: "true" }));
  });

  it("treats anything other than the exact opt-in as not set", function () {
    assert.throws(() => assertFeeIntent(0n, { SPONSORED_ALLOW_ZERO_FEE: "1" }), /sponsor gas for free/);
    assert.throws(() => assertFeeIntent(0n, { SPONSORED_ALLOW_ZERO_FEE: "yes" }), /sponsor gas for free/);
    assert.throws(() => assertFeeIntent(0n, { SPONSORED_ALLOW_ZERO_FEE: "" }), /sponsor gas for free/);
  });

  it("names both ways out in the message", function () {
    assert.throws(() => assertFeeIntent(0n, {}), /GAS_FEE_AMOUNT[\s\S]*SPONSORED_ALLOW_ZERO_FEE=true/);
  });
});

describe("gas affordability guard", function () {
  const base = { label: "SPONSOR_ADDRESS", address: "0xSponsor", nativeSymbol: "ETH" };

  it("scales the estimate with the number of calls", function () {
    assert.ok(estimateSponsoredGasLimit(2) > estimateSponsoredGasLimit(1));
  });

  it("leaves headroom over the gas a single transfer actually used", function () {
    // 146,496 on BSC Testnet, 158,848 on Arbitrum One.
    assert.ok(estimateSponsoredGasLimit(1) > 158_848n);
  });

  it("accepts a wallet that can cover the estimate", function () {
    assert.doesNotThrow(() =>
      assertCanCoverGas({ ...base, balance: 1_000_000n, gasPrice: 2n, gasLimit: 100_000n }),
    );
  });

  it("rejects dust that a zero check would have let through", function () {
    // The Arbitrum One case: not zero, and RELAYER_MIN_NATIVE_BALANCE was 0,
    // so both older guards passed and the run failed at send time.
    assert.throws(
      () => assertCanCoverGas({ ...base, balance: 1_226_363_392n, gasPrice: 10_000_000n, gasLimit: 260_000n }),
      /cannot cover gas.*Fund 0xSponsor/s,
    );
  });

  it("still names the required amount when the balance is exactly zero", function () {
    assert.throws(
      () => assertCanCoverGas({ ...base, balance: 0n, gasPrice: 5n, gasLimit: 100_000n }),
      /balance=0, estimated=500000/,
    );
  });

  it("names the wallet whose balance is too low", function () {
    assert.throws(
      () =>
        assertCanCoverGas({
          label: "backup sponsor",
          address: "0xRelayer",
          nativeSymbol: "BNB",
          balance: 0n,
          gasPrice: 5n,
          gasLimit: 100_000n,
        }),
      /backup sponsor BNB balance cannot cover gas/,
    );
  });

  it("rejects a balance one wei short and accepts an exact match", function () {
    assert.throws(
      () => assertCanCoverGas({ ...base, balance: 199_999n, gasPrice: 2n, gasLimit: 100_000n }),
      /cannot cover gas/,
    );
    assert.doesNotThrow(() =>
      assertCanCoverGas({ ...base, balance: 200_000n, gasPrice: 2n, gasLimit: 100_000n }),
    );
  });
});

describe("owner guard", function () {
  const owner = "0x7F5ee5515f494488a314a88948ebdF5e9d3C04F2";

  it("accepts the same address in any casing", function () {
    assert.doesNotThrow(() => assertSignerIsOwner(owner, owner.toLowerCase(), "setSponsor"));
    assert.doesNotThrow(() => assertSignerIsOwner(owner.toLowerCase(), owner, "setSponsor"));
  });

  it("rejects a different signer and names the action", function () {
    assert.throws(
      () => assertSignerIsOwner(owner, "0x0000000000000000000000000000000000000001", "setFeePolicy"),
      /setFeePolicy is onlyOwner/,
    );
  });
});
