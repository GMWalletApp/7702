import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeDeployedBytecode } from "../evm-7702-sponsored/scripts/four-chain-deployment-preflight.js";

describe("five-chain deployment preflight", function () {
  it("zeros immutable ranges and removes Solidity metadata before comparison", function () {
    const bytecode = "0x11aabb22a2640002";
    const immutableReferences = {
      registry: [{ start: 1, length: 2 }],
    };

    assert.equal(normalizeDeployedBytecode(bytecode, immutableReferences), "0x11000022");
  });

  it("leaves bytecode without a valid Solidity metadata trailer intact", function () {
    assert.equal(normalizeDeployedBytecode("0x6001600055", {}), "0x6001600055");
  });
});
