import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertSimulationStateUnchanged } from "../scripts/simulation-state.js";

describe("simulation state guard", function () {
  const before = {
    nonce: 8n,
    userBalance: 100n,
    merchantBalance: 20n,
    feeReceiverBalance: 5n,
  };

  it("accepts unchanged nonce and token balances", function () {
    assert.doesNotThrow(() => assertSimulationStateUnchanged(before, { ...before }));
  });

  it("rejects any state movement during negative simulations", function () {
    assert.throws(
      () => assertSimulationStateUnchanged(before, { ...before, nonce: 9n }),
      /nonce changed/,
    );
    assert.throws(
      () => assertSimulationStateUnchanged(before, { ...before, userBalance: 99n }),
      /user balance changed/,
    );
    assert.throws(
      () => assertSimulationStateUnchanged(before, { ...before, merchantBalance: 21n }),
      /merchant balance changed/,
    );
    assert.throws(
      () => assertSimulationStateUnchanged(before, { ...before, feeReceiverBalance: 6n }),
      /fee receiver balance changed/,
    );
  });
});
