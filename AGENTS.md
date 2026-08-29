# AGENTS.md

## Project scope

This branch is the standalone, self-hosted EIP-7702 relayer project. Users sign
an authorization and a set of calls off chain; an allowlisted sponsor submits a
type-4 transaction and pays native gas. The account can atomically reimburse
the sponsor in an allowlisted ERC-20, while the currently verified five-chain
configuration uses intentional zero-fee platform subsidy.

The code in this branch was extracted intact from `feat/self-relayer`. Treat
the contract behavior, deployment flow, and sending flow as stable unless a
task explicitly asks for functional changes.

## Toolchain

- Node.js and npm; use `package-lock.json` as the dependency lockfile.
- Hardhat 3.4.2 with `@nomicfoundation/hardhat-toolbox-viem`.
- viem rather than ethers in tests and scripts.
- Solidity 0.8.28.
- The `default` compiler profile is unoptimized; `production` enables the
  optimizer with 200 runs.

Hardhat reads `.env` through `configVariable()` after
`hardhat.config.ts` imports `dotenv/config`. Never commit `.env`; it contains
real private keys and has no remote backup. Add new placeholders only to
`.env.example`.

## Verification

```shell
npm test
npm run compile
npm run compile:production
```

Run the production compilation before deployment.

## Command conventions

On-chain commands use `<action>:<target>:<network>`. Supported suffixes include
`ethereum`, `bsc`, `bsc-testnet`, `arbitrum-one`, `polygon`, and `base`
where a matching script exists.

Common commands:

```shell
npm run rpc:check:<network>
npm run deploy:contracts:<network>
npm run configure:<network> -- --dry-run
npm run migrate:router:<network>
npm run preflight:five-chain

npm run sponsor:add:<network> -- --dry-run
npm run sponsor:remove:<network> -- --dry-run
npm run registry:pause:<network> -- --dry-run
npm run registry:unpause:<network> -- --dry-run
npm run owner:transfer:<network> -- --dry-run
npm run owner:accept:<network> -- --dry-run
```

Self-relayer commands:

```shell
npm run sponsored:payment:<network> -- --dry-run
npm run self:payment:arbitrum-one -- --dry-run
npm run sponsored:batch:arbitrum-one -- --dry-run
npm run canary:self-relayer -- --dry-run
```

Any mainnet live command spends real funds. The canary runner blocks live
mainnet targets unless `--allow-mainnet` is supplied.

## Configuration rules

`scripts/env-helpers.ts` resolves `<PREFIX>_<KEY>` before the shared `<KEY>`.
Because one EOA private key derives the same address on every EVM chain, the
same `SPONSOR_ADDRESS` and `SPONSOR_PRIVATE_KEY` can be reused, with optional
per-network overrides.

Private keys must be `0x` plus 64 hexadecimal characters. Scripts validate the
derived signer against the configured address before signing.

Hardhat 3 rejects unknown script flags such as a directly forwarded
`--dry-run`. The package scripts therefore translate the CLI flag into an
environment variable in a shell wrapper. Follow the existing wrapper shape for
new commands. Existing variables include `SPONSORED_DRY_RUN`,
`CONFIGURE_DRY_RUN`, `SPONSOR_DRY_RUN`, `PAUSE_DRY_RUN`, and
`OWNERSHIP_DRY_RUN`.

## Repository layout

```text
contracts/
  account/     Delegated account validation, execution, and fee payment
  router/      Allowlisted sponsor entry point
  policy/      Sponsor, token, fee, router, call-count, and pause policy
  libraries/   Call hashing and signature validation
  mocks/       Test-only ERC-20 variants and reentrancy targets
deploy/        Deployment and registry administration scripts
scripts/       Network wrappers, relayer implementation, and safety helpers
test/          Hardhat tests
evm-7702-sponsored/  SDK, ABI, integration material, canaries, and reports
```

Use `scripts/sponsored-payment.ts` for new sponsored token-payment networks
instead of copying the orchestration. Network files should remain thin wrappers
that provide chain ID, viem chain, canonical token, and explorer URL.

`scripts/sponsored-payment-checks.ts` contains pure validation and assertion
helpers. Keep it side-effect free and cover additions with unit tests.

Some independent scripts use a small entry file plus a same-name `.impl.ts`.
This keeps top-level-await logic intact while `runScript()` formats expected
configuration errors without Hardhat's misleading bug-report footer. Preserve
that pattern for similar scripts.

## Mandatory write-script safeguards

Every script that can write on chain must use the helpers in
`scripts/chain-guard.ts`:

| Helper | Purpose |
|---|---|
| `assertExpectedChainId` | Rejects an incorrect `--network` before configuration is read. |
| `assertSignerIsOwner` | Prevents an avoidable on-chain `onlyOwner` revert. |
| `isDryRun` | Applies consistent dry-run semantics. |

Add every new network to `EXPECTED_CHAIN_IDS`; unknown networks must fail
closed.

### Explicit zero-fee intent

`Sponsored7702Account._paySponsorFee` returns immediately when total fee is
zero. No fee token transfer occurs and the sponsor receives no on-chain
repayment. This is valid for platform subsidy or off-chain settlement, but it
must be explicitly enabled with `SPONSORED_ALLOW_ZERO_FEE=true` through
`assertFeeIntent`.

In zero-fee mode, registry fee caps provide no platform-side credit control.
Pricing, user balance checks, deduction/refunds, reconciliation, and exposure
limits must be implemented by the off-chain service.

### Sponsor gas coverage

Do not merely check that the sponsor's native balance is nonzero.
`assertCanCoverGas` compares the live gas price and a conservative gas estimate
against the sponsor balance and reports the exact shortfall. Reuse it in every
new sending flow.

## Operational behavior

`configure:<network>` diffs current on-chain values and writes only changes,
but it will overwrite a different on-chain fee policy with `.env` values. Use
`sponsor:add` or `sponsor:remove` when only the sponsor allowlist should
change.

Emergency pause blocks `SponsorRouter.executeSponsored` without blocking
`executeFromSelf`.

Registry owner transfer uses `Ownable2Step`. The current owner nominates
`pendingOwner`; the nominee accepts with a different signer. The first step
does not transfer ownership and can be replaced if the wrong address was
entered.

If a live relayer run reports `SENT?` or `unconfirmed`, do not blindly rerun
it. The transaction was broadcast and may be on chain even though receipt
polling timed out. Check the hash, use the read-only preflight, or inspect the
sponsored nonce before retrying. `failed` means no transaction was sent.

Dry-run and live canaries write separate reports. Generated canary reports are
overwritten on the next run; preserve long-term acceptance evidence in a
separate dated report.

## Deployment records

`/ignition/deployments/` is intentionally ignored and must not be committed.
Deployment journals associate operator addresses with transaction hashes and
belong in access-controlled operational storage. Public documentation should
use placeholders; obtain active contract addresses from the deployment owner
or the backend capability service.

Do not copy mutable sponsor, token, pause, binding, or fee-policy state from
historical documentation. Query the intended environment directly.

## Documentation and comments

Write new source comments and public-facing documentation in English. Preserve
dated reports as audit evidence; update them only to correct factual errors or
to add an explicit follow-up.
