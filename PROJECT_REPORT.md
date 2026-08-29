# EIP-7702 Self-Relayer Project Report

## Executive summary

This repository implements a self-hosted EIP-7702 sponsored-transaction system.
A user authorizes delegated account logic and signs a structured batch request.
A platform-controlled, allowlisted sponsor submits the type-4 transaction and
pays native gas. The contracts can atomically charge an ERC-20 repayment, while
the current verified five-network configuration uses zero-fee platform subsidy.

The full path has been exercised on Ethereum, BNB Smart Chain, Arbitrum One,
Polygon PoS, and BSC Testnet. Production-path scripts include chain and signer
guards, state-override simulation, sponsor gas coverage checks, controlled gas
limits, receipt assertions, and a multi-network canary runner.

## Problem and objective

Users may hold an ERC-20 asset but no native ETH, BNB, or POL, making an
otherwise valid transfer impossible. The project lets the user retain the same
EOA address and assets while a sponsor pays native gas.

The system supports:

- EIP-7702 delegation without moving assets to a new smart-wallet address.
- One user signature over one or more business calls.
- A self-hosted sponsor that broadcasts the type-4 transaction.
- Optional atomic ERC-20 gas and service-fee repayment.
- Intentional zero-fee subsidy with explicit operator confirmation.
- Registry-managed sponsors, fee tokens, fee limits, routing, and emergency
  pause.

## Delivered components

### Contracts

- `Sponsored7702Account`: verifies EIP-712 requests, sponsored nonces,
  deadlines, sponsor binding, and calls; executes batches; and optionally pays
  the fee receiver.
- `SponsorRouter`: enforces the sponsor allowlist, rejects native value, and
  forwards requests to the delegated account.
- `SponsorPolicyRegistry`: manages owner-controlled policy, sponsors, fee
  tokens, fee limits, maximum calls, router binding, and pause state.
- Hashing and signature libraries, interfaces, shared types, custom errors, and
  adversarial token/reentrancy mocks.

### Deployment and administration

The repository includes network-aware scripts for:

- RPC and chain ID checks.
- Production-profile deployment.
- Idempotent registry configuration.
- Sponsor allowlist changes.
- Router migration.
- Emergency pause and recovery.
- Two-step owner transfer.
- Read-only multi-network deployment preflight.

Every write flow rejects the wrong chain before reading mutable configuration.
Owner-only flows validate the signer against the on-chain owner before
broadcasting.

### Self-relayer

The shared self-relayer implementation covers Ethereum, BSC, BSC Testnet,
Arbitrum One, and Polygon through thin network wrappers. It performs:

1. Configuration, address, chain, token, amount, and fee-intent checks.
2. Fixed-slot sponsored nonce reads that remain correct across delegation
   changes.
3. EIP-7702 authorization signer recovery and validation.
4. EIP-712 request construction and user signing.
5. Full signed simulation using a target-runtime state override.
6. Sponsor native-balance checks against live gas price and a conservative gas
   estimate.
7. Type-4 broadcast with a controlled gas limit.
8. Receipt, sender, destination, event, token-balance, native-balance, and nonce
   assertions.

Arbitrum also includes examples for multi-recipient sponsored batches and the
user-funded `executeFromSelf` path.

### Canary runner

The five-network canary runner invokes the same single-network production
scripts rather than duplicating sending logic. It supports dry-run, selected
targets, per-target token/amount overrides, and separate dry-run/live reports.

Live mainnet execution is blocked unless `--allow-mainnet` is explicitly
provided. A broadcast whose receipt cannot be confirmed is reported as
`SENT?`/`unconfirmed` so operators do not accidentally send a duplicate.

## Settlement modes

### Platform subsidy

With both fee amounts set to zero, the account skips ERC-20 repayment. The user
pays only the business amount, the sponsor pays native gas, and no `FeePaid`
event is emitted.

This behavior must be acknowledged with
`SPONSORED_ALLOW_ZERO_FEE=true`. The five verified network policies currently
enforce this mode with zero fee ceilings.

### Atomic ERC-20 repayment

When a nonzero fee is configured, the user signature binds the fee token,
amounts, and receiver. The account transfers repayment after successful
business calls. A failed repayment reverts the complete batch.

The contracts handle ERC-20 tokens that return `true`, return no value, or
return `false` according to the tested safe-transfer behavior.

### Off-chain settlement boundary

Repayment using an asset or custodial balance on another chain cannot be atomic
with an EVM transaction. The contract can execute with zero on-chain fee, but an
off-chain platform must then own pricing, pre-debit/refund sequencing,
reconciliation, exposure limits, and failure recovery. Registry fee caps do not
replace those controls in zero-fee mode.

## Verified networks

| Network | Chain ID | Status |
|---|---:|---|
| Ethereum Mainnet | 1 | Contracts and real self-relayed type-4 transaction verified |
| BNB Smart Chain | 56 | Contracts and real self-relayed type-4 transaction verified |
| BSC Testnet | 97 | Contracts, mocks, policy failures, and sponsored execution verified |
| Arbitrum One | 42161 | Contracts, single/batch sponsored execution, and self execution verified |
| Polygon PoS | 137 | Contracts and real zero-fee native-USDC canary verified |

Sanitized deployment and acceptance summaries remain under
`evm-7702-sponsored/reports/`. Personally attributable wallet addresses,
transaction identifiers, and deployment journals are excluded from the public
tree.

## Test coverage

The Hardhat suite covers, among other cases:

- Delegated execution without initialization.
- EIP-712 and ERC-1271 signature paths.
- Sponsored nonce replay protection and deadlines.
- Sponsor, account, calls, fee token, amount, and receiver binding.
- Sponsor and fee-token allowlists.
- Fee ceilings and maximum batch size.
- Zero-fee subsidy.
- Atomic rollback when a call or repayment fails.
- Empty calls, zero targets, false-return and no-return ERC-20s.
- Router native-value rejection.
- Registry pause and recovery.
- Reentrancy attempts.
- Chain, signer, environment, fee-intent, gas-coverage, simulation, and receipt
  helper behavior.

Use the repository's current test output as the source of truth rather than a
hard-coded historical passing count:

```shell
npm test
npm run compile:production
```

## Production responsibilities

The repository provides deployable contracts and executable reference flows,
but a production relayer service must still supply:

- KMS/HSM or equivalent sponsor-key custody.
- Authentication, authorization, and rate limiting.
- Trusted quote generation and call allowlisting.
- Per-user and per-period limits.
- Atomic sponsor transaction-nonce allocation.
- Idempotent request handling and duplicate prevention.
- RPC failover and transaction replacement policy.
- Indexing, settlement, reconciliation, monitoring, and alerting.
- Wallet compatibility testing for EIP-7702 authorization signing.
- Independent contract and operational security review.

## Open-source preparation status

The standalone branch contains the complete self-relayer code, deployment
scripts, tests, SDK/ABI delivery package, tracked deployment evidence, an
English README, and English source comments. No license has been selected or
added yet.
