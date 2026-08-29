import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateRouterMigrationPreflight } from "../scripts/router-migration-plan.js";

const owner = "0x0000000000000000000000000000000000000001";
const oldRouter = "0x0000000000000000000000000000000000000002";

describe("router migration plan", function () {
  it("accepts a matching chain, owner, router, and funded signer", function () {
    assert.doesNotThrow(() =>
      validateRouterMigrationPreflight({
        actualChainId: 97,
        expectedChainId: 97,
        owner,
        signer: owner,
        currentRouter: oldRouter,
        expectedCurrentRouter: oldRouter,
        signerNativeBalance: 10n,
        minimumNativeBalance: 5n,
      }),
    );
  });

  it("rejects the wrong chain, owner, or current router", function () {
    assert.throws(
      () =>
        validateRouterMigrationPreflight({
          actualChainId: 56,
          expectedChainId: 97,
          owner,
          signer: owner,
          currentRouter: oldRouter,
          expectedCurrentRouter: oldRouter,
          signerNativeBalance: 10n,
          minimumNativeBalance: 5n,
        }),
      /chain ID mismatch/,
    );
    assert.throws(
      () =>
        validateRouterMigrationPreflight({
          actualChainId: 97,
          expectedChainId: 97,
          owner,
          signer: "0x0000000000000000000000000000000000000003",
          currentRouter: oldRouter,
          expectedCurrentRouter: oldRouter,
          signerNativeBalance: 10n,
          minimumNativeBalance: 5n,
        }),
      /Registry owner does not match/,
    );
    assert.throws(
      () =>
        validateRouterMigrationPreflight({
          actualChainId: 97,
          expectedChainId: 97,
          owner,
          signer: owner,
          currentRouter: "0x0000000000000000000000000000000000000004",
          expectedCurrentRouter: oldRouter,
          signerNativeBalance: 10n,
          minimumNativeBalance: 5n,
        }),
      /current Router does not match/,
    );
  });

  it("rejects an underfunded owner signer", function () {
    assert.throws(
      () =>
        validateRouterMigrationPreflight({
          actualChainId: 97,
          expectedChainId: 97,
          owner,
          signer: owner,
          currentRouter: oldRouter,
          expectedCurrentRouter: oldRouter,
          signerNativeBalance: 4n,
          minimumNativeBalance: 5n,
        }),
      /native balance is below/,
    );
  });
});
