# EIP-7702 Self-Relayer Sponsored Account

This repository contains a complete EIP-7702 sponsored-account system and a
self-hosted relayer flow. A user signs an authorization and a batch of calls
off chain. An allowlisted sponsor submits the EIP-7702 type-4 transaction and
pays the native gas.

The contracts support two settlement modes:

- **Platform subsidy:** the sponsor pays all native gas and the user pays only
  the business transfer amount. This is the policy currently configured on the
  verified five-chain deployments.
- **ERC-20 repayment:** the user atomically repays gas and an optional service
  fee in an allowlisted ERC-20 token in the same transaction.

The repository uses a sponsor private key directly. It does not depend on a
third-party relayer API.

> [!WARNING]
>This software has undergone an internal security review but has not yet been independently audited by an external security firm. Before using or >deploying the code, you should carefully review all components and assess any potential security, operational, and financial risks.

>You are solely responsible for your deployment, configuration, security practices, and use of this software, including any transactions or losses >resulting from its use.


## How it works

1. The user EOA signs an EIP-7702 authorization for
   `Sponsored7702Account`.
2. The user signs an EIP-712 `SponsoredCall` containing the account, nonce,
   deadline, sponsor, fee terms, and hash of the business calls.
3. The allowlisted sponsor sends a type-4 transaction to
   `SponsorRouter.executeSponsored` and pays the native gas.
4. The router verifies sponsor policy and forwards the request to the delegated
   user account.
5. The account verifies the signature and nonce, executes the calls atomically,
   and, when configured, transfers the ERC-20 repayment to `feeReceiver`.

If any business call or fee transfer fails, the entire transaction reverts.

## Contracts

- `contracts/account/Sponsored7702Account.sol` implements the delegated EOA
  logic, EIP-712 validation, replay protection, deadlines, batched calls, and
  optional ERC-20 fee settlement.
- `contracts/router/SponsorRouter.sol` is the allowlisted sponsor entry point.
  It rejects native value and forwards sponsored requests.
- `contracts/policy/SponsorPolicyRegistry.sol` manages sponsors, fee tokens,
  fee limits, `feeReceiver`, router binding, maximum call count, and emergency
  pause state.
- `contracts/libraries/` contains call hashing and signature validation.
- `contracts/mocks/` contains test-only targets and ERC-20 variants.

The account also exposes `executeFromSelf` for user-funded transactions. A
registry pause blocks sponsored execution without preventing a user from
controlling their own assets through that path.

## Supported networks

| Network | Chain ID | Sponsored payment | Deployment/configuration |
|---|---:|---:|---:|
| Ethereum Mainnet | 1 | Yes | Yes |
| BNB Smart Chain | 56 | Yes | Yes |
| BSC Testnet | 97 | Yes | Yes |
| Arbitrum One | 42161 | Yes | Yes |
| Polygon PoS | 137 | Yes | Yes |
| Base | 8453 | No dedicated payment wrapper | Yes |

Canonical mainnet token restrictions are enforced by thin network wrapper
scripts where applicable. Polygon uses native USDC, not USDC.e.

## Requirements

- Node.js and npm
- An RPC endpoint for each target network
- A deployment/configuration owner account funded with native gas
- A sponsor account funded with native gas
- A user account holding the business ERC-20 token

This project uses Hardhat 3, Solidity 0.8.28, viem, and npm. The production
compiler profile enables the optimizer with 200 runs.

## Install and verify

```shell
npm install
npm test
npm run compile:production
```

The default build remains available as `npm run compile`.

## Configuration

Copy the environment template and replace every value required for the target
network:

```shell
cp .env.example .env
```

Never commit `.env`. It contains real private keys and has no remote backup.

Configuration uses a network-prefix-first fallback rule. For example,
`ARBITRUM_ONE_SPONSOR_ADDRESS` overrides the shared `SPONSOR_ADDRESS`; if the
prefixed value is absent, the shared value is used. One EOA private key derives
the same address on every EVM chain, so a single sponsor can be reused across
networks.

Private keys must be `0x` followed by exactly 64 hexadecimal characters. The
scripts verify that each key derives the configured address before signing.

Important shared values include:

```env
USER_PRIVATE_KEY=0xYOUR_USER_PRIVATE_KEY
SPONSOR_PRIVATE_KEY=0xYOUR_SPONSOR_PRIVATE_KEY
USER_ADDRESS=0xYOUR_USER_ADDRESS
SPONSOR_ADDRESS=0xYOUR_SPONSOR_ADDRESS
MERCHANT_ADDRESS=0xYOUR_MERCHANT_OR_RECIPIENT_ADDRESS
INITIAL_OWNER=0xYOUR_REGISTRY_OWNER_ADDRESS
INITIAL_FEE_RECEIVER=0xYOUR_FEE_RECEIVER_ADDRESS
SPONSORED_CALL_DEADLINE_SECONDS=3600
SERVICE_FEE_AMOUNT=0
MAX_SERVICE_FEE_AMOUNT=0
MAX_CALLS=10
SPONSORED_ALLOW_ZERO_FEE=true
```

See [`.env.example`](.env.example) for all network-specific contract, token,
amount, balance, and RPC settings.

### Zero-fee mode

When `gasFeeAmount + serviceFeeAmount` is zero,
`Sponsored7702Account` intentionally skips the fee token transfer. No fee token
or `feeReceiver` is required for execution, and no `FeePaid` event is emitted.
This is a valid platform-subsidy mode, but it means the sponsor receives no
on-chain repayment.

The sending scripts require `SPONSORED_ALLOW_ZERO_FEE=true` to acknowledge this
behavior explicitly. In zero-fee mode, on-chain fee caps do not provide
off-chain credit or settlement risk controls; those controls belong in the
relayer service.

## Deployment

Always check the RPC and chain ID first, then deploy with the production build:

```shell
npm run rpc:check:<network>
npm run compile:production
npm run deploy:contracts:<network>
```

Supported command suffixes are `ethereum`, `bsc`, `bsc-testnet`,
`arbitrum-one`, `polygon`, and `base` where a matching script exists.

Copy the three deployed addresses into `.env`:

```env
<PREFIX>_POLICY_REGISTRY=0x...
<PREFIX>_ACCOUNT_IMPLEMENTATION=0x...
<PREFIX>_SPONSOR_ROUTER=0x...
```

Then preview and apply the registry configuration:

```shell
npm run configure:<network> -- --dry-run
npm run configure:<network>
```

`configure` reads current on-chain state and writes only differences. It also
applies the fee policy from `.env`; use the sponsor-specific command when only
the sponsor allowlist should change.

```shell
npm run sponsor:add:<network> -- --dry-run
npm run sponsor:add:<network>
npm run sponsor:remove:<network> -- --dry-run
```

All write scripts enforce the expected chain ID. Owner-only scripts also verify
that the configured signer is the current registry owner before sending a
transaction.

## Running the self-relayer

Preview a single sponsored token payment:

```shell
npm run sponsored:payment:<network> -- --dry-run
```

Send it only after reviewing the dry-run output:

```shell
npm run sponsored:payment:<network>
```

Dedicated payment wrappers are available for Ethereum, BSC, BSC Testnet,
Arbitrum One, and Polygon. Additional Arbitrum examples cover a sponsored batch
and the user-funded path:

```shell
npm run sponsored:batch:arbitrum-one -- --dry-run
npm run self:payment:arbitrum-one -- --dry-run
```

The relayer performs preflight validation, reads the sponsored nonce from the
fixed account storage slot, validates any existing EIP-7702 delegation,
simulates the fully signed call with a state override, checks that the sponsor
can cover a conservative gas estimate, broadcasts with a controlled gas limit,
and verifies receipt events, balances, transaction type, addresses, and nonce.

### Five-chain canary

Run the full production-path readiness scan without broadcasting:

```shell
npm run canary:self-relayer -- --dry-run
```

Run a subset with `--only=key1,key2`. A misspelled target is rejected instead
of silently producing an empty run.

Live mainnet targets are blocked unless `--allow-mainnet` is explicitly
provided. Every passing live target sends a real transaction and spends real
funds:

```shell
npm run canary:self-relayer -- --allow-mainnet
```

Generated reports are written under `evm-7702-sponsored/reports/`. Dry-run and
live reports use different filenames so a preview cannot overwrite live
transaction hashes.

If a run reports `SENT?` or `unconfirmed`, do not immediately retry. The
transaction was broadcast but receipt polling did not finish, often because of
RPC rate limits. Check the transaction hash in an explorer or run the read-only
preflight before deciding whether another transaction is safe. Only `failed`
means the transaction was not sent.

## Operations

Read the current five-chain deployment and registry state without sending a
transaction:

```shell
npm run preflight:five-chain
```

Emergency pause and recovery:

```shell
npm run registry:pause:<network> -- --dry-run
npm run registry:pause:<network>
npm run registry:unpause:<network> -- --dry-run
npm run registry:unpause:<network>
```

Registry ownership uses `Ownable2Step`:

```shell
npm run owner:transfer:<network> -- --dry-run
npm run owner:transfer:<network>
# Change <PREFIX>_PRIVATE_KEY to the nominated owner.
npm run owner:accept:<network> -- --dry-run
npm run owner:accept:<network>
```

The first step only nominates `pendingOwner`; ownership moves in the second
step. An incorrect nomination can be replaced by the current owner.

## Security properties and limits

- The EIP-712 signature binds the delegated account, chain, sponsored nonce,
  deadline, sponsor, calls hash, fee token, fee amounts, and fee receiver.
- Sponsored nonces prevent replay and are separate from both the EOA
  authorization nonce and the sponsor transaction nonce.
- The router accepts only allowlisted sponsors and rejects `msg.value`.
- Fee tokens and all fee ceilings are registry-controlled.
- A maximum business-call count limits sponsored batches.
- Failed business calls and failed ERC-20 repayment revert atomically.
- ERC-20 transfers support standard, no-return, and false-return behavior.
- Reentrancy and signature edge cases are covered by the test suite.
- Sponsor solvency, quote generation, idempotency, transaction nonce
  allocation, reconciliation, monitoring, rate limits, and key custody remain
  production service responsibilities.

## Repository layout

```text
contracts/               Solidity contracts, interfaces, libraries, and mocks
deploy/                  Deployment and registry administration scripts
ignition/                Hardhat Ignition deployment modules
scripts/                 Self-relayer flows and shared safety helpers
test/                    Hardhat tests
evm-7702-sponsored/      SDK, ABI, integration docs, canary tools, and reports
```

The thin network wrappers call the shared implementation in
`scripts/sponsored-payment.ts`. Input checks, gas coverage, receipt assertions,
and failure guidance live in `scripts/sponsored-payment-checks.ts`.

## Verification evidence

Sanitized deployment and acceptance summaries are retained in
`evm-7702-sponsored/reports/`. Operator addresses, user addresses, transaction
hashes, provider identifiers, and deployment journals are intentionally not
published.

## License

No license has been added yet. Until a license is selected, normal copyright
rules apply; public visibility alone does not grant permission to copy, modify,
or redistribute the code.
