import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANARY_TARGETS,
  childEnvFor,
  classifyResult,
  extractFailure,
  extractTxHash,
  isTargetBlocked,
  parseArgs,
  selectTargets,
} from "../evm-7702-sponsored/scripts/self-relayer-canary-plan.js";

const target = CANARY_TARGETS[0];
const mainnetTarget = CANARY_TARGETS.find((t) => t.isMainnet)!;
const testnetTarget = CANARY_TARGETS.find((t) => !t.isMainnet)!;

describe("canary target table", function () {
  it("gives every target a unique key", function () {
    const keys = CANARY_TARGETS.map((t) => t.chainKey);
    assert.equal(new Set(keys).size, keys.length);
  });

  it("covers both BSC Testnet tokens so a token-specific failure is caught", function () {
    const bscTestnet = CANARY_TARGETS.filter((t) => t.network === "bscTestnet");
    assert.deepEqual(
      bscTestnet.map((t) => t.tokenSymbol).sort(),
      ["USDC", "USDT"],
    );
  });

  it("covers the Polygon native USDC production path", function () {
    const polygon = CANARY_TARGETS.find((t) => t.chainKey === "polygon-usdc");
    assert.equal(polygon?.network, "polygon");
    assert.equal(polygon?.tokenSymbol, "USDC");
    assert.equal(polygon?.tokenEnvKey, "USDC_TOKEN_ADDRESS");
    assert.equal(polygon?.isMainnet, true);
  });

  it("points every target at a per-chain script that exists in this branch", function () {
    for (const t of CANARY_TARGETS) {
      assert.match(t.script, /^scripts\/[a-z-]+\/run-sponsored-token-payment\.ts$/);
    }
  });
});

describe("argument parsing", function () {
  it("detects --dry-run", function () {
    assert.equal(parseArgs(["--dry-run"]).dryRun, true);
    assert.equal(parseArgs([]).dryRun, false);
  });

  it("detects --allow-mainnet", function () {
    assert.equal(parseArgs(["--allow-mainnet"]).allowMainnet, true);
    assert.equal(parseArgs([]).allowMainnet, false);
  });

  it("accepts --only as a repeated flag or a comma list", function () {
    assert.deepEqual(parseArgs(["--only=a", "--only=b"]).only, ["a", "b"]);
    assert.deepEqual(parseArgs(["--only=a,b"]).only, ["a", "b"]);
    assert.deepEqual(parseArgs(["--only= a , b "]).only, ["a", "b"]);
  });

  it("treats no --only as no filter", function () {
    assert.deepEqual(parseArgs(["--dry-run"]).only, []);
  });
});

describe("target selection", function () {
  it("returns every target when no filter is given", function () {
    assert.equal(selectTargets(CANARY_TARGETS, []).length, CANARY_TARGETS.length);
  });

  it("keeps only the requested targets", function () {
    const selected = selectTargets(CANARY_TARGETS, ["bsc-testnet-usdt"]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].chainKey, "bsc-testnet-usdt");
  });

  it("fails loudly on a typo instead of silently running nothing", function () {
    assert.throws(() => selectTargets(CANARY_TARGETS, ["bsc-testnet-usd"]), /Unknown --only target/);
  });
});

describe("mainnet gate", function () {
  it("blocks a live mainnet target by default", function () {
    // The gate exists because the canary spawns hardhat as a child process,
    // so per-command permission rules never see the inner invocation.
    assert.equal(isTargetBlocked(mainnetTarget, false, false), true);
  });

  it("lets a live mainnet target through only with --allow-mainnet", function () {
    assert.equal(isTargetBlocked(mainnetTarget, false, true), false);
  });

  it("never blocks a dry run, which spends nothing", function () {
    assert.equal(isTargetBlocked(mainnetTarget, true, false), false);
    assert.equal(isTargetBlocked(mainnetTarget, true, true), false);
  });

  it("never blocks a testnet target", function () {
    assert.equal(isTargetBlocked(testnetTarget, false, false), false);
    assert.equal(isTargetBlocked(testnetTarget, true, false), false);
  });

  it("marks exactly the four mainnet chains", function () {
    assert.deepEqual(
      CANARY_TARGETS.filter((t) => t.isMainnet).map((t) => t.network).sort(),
      ["arbitrumOne", "bsc", "ethereum", "polygon"],
    );
  });
});

describe("child env overrides", function () {
  it("pins the token and amount with the per-chain prefix", function () {
    const env = childEnvFor(target, "0xabc", "1000", false);
    assert.equal(env[`${target.envPrefix}_FEE_TOKEN_ADDRESS`], "0xabc");
    assert.equal(env[`${target.envPrefix}_PAYMENT_AMOUNT`], "1000");
  });

  it("passes dry run through, and only when asked", function () {
    assert.equal(childEnvFor(target, "0xabc", "1000", true).SPONSORED_DRY_RUN, "true");
    assert.equal("SPONSORED_DRY_RUN" in childEnvFor(target, "0xabc", "1000", false), false);
  });

  it("never sets a global key that would leak into other targets", function () {
    const env = childEnvFor(target, "0xabc", "1000", false);
    assert.equal("FEE_TOKEN_ADDRESS" in env, false);
    assert.equal("PAYMENT_AMOUNT" in env, false);
  });
});

describe("result classification", function () {
  const hash = `0x${"a".repeat(64)}`;

  it("calls a clean exit passed", function () {
    assert.equal(classifyResult(0, hash), "passed");
    assert.equal(classifyResult(0, undefined), "passed");
  });

  it("calls a non-zero exit with no transaction a failure", function () {
    assert.equal(classifyResult(1, undefined), "failed");
  });

  it("calls a non-zero exit that already sent a transaction unconfirmed", function () {
    // BSC's public RPC returned 403 while polling for the receipt on a
    // transaction that had already landed. Reporting that as failed invited a
    // re-run, and a re-run spends again.
    assert.equal(classifyResult(1, hash), "unconfirmed");
  });
});

describe("child output parsing", function () {
  it("extracts the transaction hash the scripts print", function () {
    const hash = `0x${"a".repeat(64)}`;
    assert.equal(extractTxHash(`preflight...\ntx: ${hash}\nstatus: success`), hash);
  });

  it("returns nothing for a dry run that never sent one", function () {
    assert.equal(extractTxHash("Dry run enabled; not signing and not sending a transaction."), undefined);
  });

  it("ignores a malformed hash rather than reporting a bad one", function () {
    assert.equal(extractTxHash("tx: 0x1234"), undefined);
  });

  it("reads the failure message and skips the hint line", function () {
    const stderr = "SPONSOR_ADDRESS is not allowed in registry: 0x1\n\nHint: Whitelist the sponsor first";
    assert.equal(extractFailure(stderr), "SPONSOR_ADDRESS is not allowed in registry: 0x1");
  });

  it("reports the reason, not the library version, for a multi-line viem error", function () {
    // Reading from the end used to surface "Version: viem@2.48.4" as the
    // failure reason for every viem-originated error.
    const stderr = [
      "Execution reverted with reason: gas required exceeds allowance (50925).",
      "",
      "Request Arguments:",
      "  from:  0x695E586c5F5034dA8854924fA1Ab4C3f063D012A",
      "  data:  0xf5f8fa58deadbeef",
      "",
      "Details: gas required exceeds allowance (50925)",
      "Version: viem@2.48.4",
    ].join("\n");
    assert.equal(
      extractFailure(stderr),
      "Execution reverted with reason: gas required exceeds allowance (50925).",
    );
  });

  it("returns nothing when stderr is empty", function () {
    assert.equal(extractFailure(""), undefined);
    assert.equal(extractFailure("\n  \n"), undefined);
  });
});
