# EVM EIP-7702 Four-Chain Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First complete independent contract acceptance for BSC Mainnet, BSC Testnet, Ethereum Mainnet, and Arbitrum One; only after the contract is accepted, integrate the backend and then publish a frontend SDK wrapper.

**Architecture:** Phase 1 is entirely contract-owned: local Solidity tests, four-chain deployment readback, rejection simulation, and direct legacy provider canaries all live in `EIP-7702` and do not depend on GM Wallet capabilities. Phase 2 is a later backend integration that exposes the four chains through `config → preview → execute → status`. Phase 3 packages the existing TypeScript helpers as a frontend-facing SDK; the frontend constructs calls and signs, while the backend/relayer broadcasts and pays native gas.

**Tech Stack:** Solidity 0.8.28, Hardhat 3, Node test runner, TypeScript, viem, EIP-712, EIP-7702, legacy provider APIs, GM Wallet device request signing in the deferred backend phase, JSON/Markdown evidence reports.

## Global Constraints

- Target chains are `bsc` (56), `bsc-testnet` (97), `eth` (1), and `arb1` (42161).
- Current acceptance scope is the contract, deployed configuration, EIP-712 signature, EIP-7702 authorization, relayer broadcast, events, nonce, and token accounting.
- Phase 1 direct contract canaries do not depend on `GET /v1/capabilities/sponsor-chains`.
- A successful contract canary proves the contract/relayer path only; it does not prove the future GM Wallet `preview → execute → settlement` flow.
- Backend capabilities and the `arb1` API route are Phase 2 deliverables and must not be reported as Phase 1 contract failures.
- Mainnet broadcasts require an explicit per-run paid gate and must run serially in this order: BSC Testnet, BSC Mainnet, Arbitrum One, Ethereum Mainnet.
- Never retry a paid run while its process or execution remains non-terminal.
- Every Phase 1 success must record `tx_hash`, block number, receipt status, relayer address, router address, sponsored nonce delta, token balance deltas, native gas payer, and contract events.
- Every Phase 1 rejection case must prove there was no sponsored nonce change and no user, merchant, or fee-receiver token movement.
- The frontend SDK must never hold a sponsor/relayer private key and must never broadcast `SponsorRouter.executeSponsored` itself.
- `neo-invite-server` is outside Phase 1 and remains downstream-only after backend integration: it consumes settled billing for rebate/campaign logic, not EIP-7702 signing or broadcast.

---

## Delivery Phases

| Phase | Scope | Completion gate |
| --- | --- | --- |
| **Phase 1 — now** | Contract tests, deployed bytecode/config readback, rejection simulations, four direct chain canaries | Four receipts succeed and reconcile; all contract boundary tests pass |
| **Phase 2 — later** | Backend adds four chains and exposes config/preview/execute/status | Four backend executions settle and accounting matches chain results |
| **Phase 3 — later** | Frontend SDK wraps call construction, EIP-712 signing, EIP-7702 authorization, and payload serialization | Browser/mobile integration tests produce backend-accepted payloads |

The current task stops after Phase 1. Phase 2 and Phase 3 remain documented below so contract interfaces are not changed in ways that make later integration impossible.

---

## Phase 1 — Contract Acceptance

### Task 1: Add Missing Contract Boundary Tests and Reject Unexpected Native Value

**Files:**
- Modify: `test/Sponsored7702Account.ts`
- Modify: `contracts/errors/Errors.sol`
- Modify: `contracts/router/SponsorRouter.sol`
- Create: `contracts/mocks/MockNoReturnERC20.sol`
- Create: `contracts/mocks/MockReentrantTarget.sol`

**Interfaces:**
- Consumes: existing `fixture()`, `signSponsoredRequest()`, `SponsorRouter.executeSponsored()`.
- Produces: deterministic local coverage for domain separation, exact policy boundaries, atomic rollback, token compatibility, and reentrancy.

- [x] **Step 1: Add a wrong-chain EIP-712 signature test**

Sign the same `SponsoredCall` with `chainId + 1`, submit it on the local chain, and assert `InvalidSignature`, nonce `0`, and unchanged target state.

- [x] **Step 2: Add a wrong-verifying-contract signature test**

Sign with `verifyingContract=router.address` instead of the delegated account and assert `InvalidSignature` with no state or fee movement.

- [x] **Step 3: Add exact-boundary fee tests**

Set `maxGasFeeAmount=10`, `maxServiceFeeAmount=5`, `maxTotalFeeAmount=15`; assert `10+5` succeeds, gas `+1` and service `+1` revert with their matching errors, then lower only `maxTotalFeeAmount` to `14` and assert `10+5` reverts with `TotalFeeTooHigh`.

- [x] **Step 4: Add exact-boundary call-count tests**

Set `maxCalls=2`; assert two calls succeed atomically and three calls revert without changing target state or nonce.

- [x] **Step 5: Add full atomic-rollback assertions**

Build a batch whose first call succeeds and second call reverts. Assert target state, ERC-20 fee balances, account nonce, and emitted logs all roll back.

- [x] **Step 6: Add a no-return ERC-20 fee test**

Implement `MockNoReturnERC20.transfer(address,uint256)` without a return value, whitelist it, and verify `SafeERC20` accepts the transfer while preserving exact balance accounting.

- [x] **Step 7: Add a reentrant target test**

Have a target attempt to call `executeSponsoredFromRouter` and `executeFromSelf`. Assert direct router bypass remains blocked and no second sponsored nonce can be consumed.

- [x] **Step 8: Write the failing nonzero native-value test**

Send `msg.value=1` to `SponsorRouter.executeSponsored` and expect `UnexpectedNativeValue`. Before the fix, the test must fail because the current router accepts and retains the value.

- [x] **Step 9: Reject unexpected native value**

Add `UnexpectedNativeValue` to `Errors.sol` and reject `msg.value != 0` at the start of `SponsorRouter.executeSponsored`. EIP-7702 business calls may still send native value from the delegated account through `Types.Call.value`; sponsor gas remains paid by the relayer.

- [x] **Step 10: Run the contract suite**

Run:

```bash
npm run compile
npm test
```
Result: 28/28 Node.js contract cases pass, including the new router-value rejection.

- [x] **Step 11: Commit**

```bash
git add contracts/errors/Errors.sol contracts/router/SponsorRouter.sol contracts/mocks/MockNoReturnERC20.sol contracts/mocks/MockReentrantTarget.sol test/Sponsored7702Account.ts
git commit -m "fix: reject unexpected native value in sponsor router"
```

---

### Task 2: Add a Read-Only Four-Chain Deployment Preflight

**Files:**
- Create: `evm-7702-sponsored/scripts/check-four-chain-deployments.ts`
- Create: `evm-7702-sponsored/scripts/four-chain-deployment-preflight.ts`
- Create: `test/FourChainDeploymentPreflight.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: per-chain RPC, registry, account implementation, router, sponsor, and fee-token environment values.
- Produces: `FourChainDeploymentCheck` rows and a nonzero exit code when any mandatory invariant fails.

- [x] **Step 1: Implement bytecode normalization**

Load Hardhat artifacts, zero all ranges in `immutableReferences`, and compare normalized deployed bytecode hashes for:

```ts
type ContractCheck = {
  address: `0x${string}`;
  hasCode: boolean;
  normalizedBytecodeMatches: boolean;
};
```

- [x] **Step 2: Implement registry readback**

For every chain, read and assert:

```ts
type RegistryCheck = {
  routerMatches: boolean;
  paused: boolean;
  sponsorAllowed: boolean;
  feeTokenAllowed: boolean;
  maxGasFeeAmount: string;
  maxServiceFeeAmount: string;
  maxTotalFeeAmount: string;
  maxCalls: string;
};
```

- [x] **Step 3: Add chain identity checks**

Assert RPC chain IDs are exactly `1`, `56`, `97`, and `42161`; never infer a chain from an RPC URL.

- [x] **Step 4: Add scripts**

Add:

```json
{
  "preflight:four-chain": "hardhat run evm-7702-sponsored/scripts/check-four-chain-deployments.ts --no-compile"
}
```

- [x] **Step 5: Run the preflight**

Run:

```bash
npm run preflight:four-chain
```

Expected: all twelve deployed contracts have code and match current compiled bytecode; all registries are unpaused and correctly configured.

Current result: all four RPC chain IDs and all Registry/Account checks pass. All four chains now use the guarded Router and pass the complete preflight.

Migration result: the guarded Router is deployed and registered on all four chains. All four live canaries completed successfully.

- [x] **Step 6: Commit**

```bash
git add evm-7702-sponsored/scripts/check-four-chain-deployments.ts evm-7702-sponsored/scripts/four-chain-deployment-preflight.ts test/FourChainDeploymentPreflight.ts package.json
git commit -m "test: add four-chain deployment preflight"
```

---

### Task 3: Run Four Direct Contract Canaries

**Files:**
- Create: `evm-7702-sponsored/reports/four-chain-contract-acceptance-2026-07-28.md`
- Reuse: the then-current BSC Testnet provider payload and execution scripts
- Reuse: the then-current BSC provider payload and execution scripts
- Reuse: the then-current Arbitrum One provider payload and execution scripts
- Reuse: the then-current Ethereum provider payload and execution scripts

**Interfaces:**
- Consumes: passing local contract tests, passing deployment preflight, funded user token balances, funded provider native balances, and per-chain provider endpoints.
- Produces: four direct EIP-7702 contract transactions and a reconciled contract acceptance report; no GM Wallet API is involved.

- [x] **Step 1: Run per-chain paid preflight**

For every chain, verify:

```text
RPC chain ID matches
registry/router/account implementation bytecode matches
registry is not paused
relayer is an allowed sponsor
fee token is allowlisted
fee amounts are within policy
user token balance covers payment plus token fee
relayer native balance covers transaction gas
merchant and feeReceiver addresses are distinct test destinations
```

Current result: payload construction, dry-run, guarded Router migration, and live canary pass on all four chains, with exact event, nonce, and token-balance reconciliation. Evidence: `evm-7702-sponsored/reports/four-chain-contract-preflight-2026-07-28.md`.

- [x] **Step 2: Run BSC Testnet first**

```bash
npm run prepare:provider:bsc-testnet
npm run call:provider:bsc-testnet -- --dry-run
npm run call:provider:bsc-testnet
```

Wait for a successful receipt and reconcile it before starting another chain.

Result: transaction `0x000000000000000000000000000000000000000000000000d21172f8d36e3c8b` succeeded against Router `0x000000000000000000000000c56f61bc69930ed6`; nonce and all token balance deltas reconciled exactly.

The deployed Router also passed a read-only boundary matrix for unexpected native value, sponsor authorization, fee policy, token/receiver policy, call count, nonce, deadline, and signed calls. All negative simulations left nonce and token balances unchanged.

- [x] **Step 3: Run BSC Mainnet**

```bash
npm run prepare:provider:bsc
npm run call:provider:bsc -- --dry-run
npm run call:provider:bsc
```

Use the configured minimal canonical BSC token amount and record the exact 18-decimal raw value.

Result: transaction `0x0000000000000000000000000000000000000000000000007afee67cb983ff64` succeeded against Router `0x000000000000000000000000ab2d2b5fb2e29d11`; nonce advanced `3 → 4`, and the `0.001 USDT` payment plus `0.001 USDT` token fee reconciled exactly.

- [x] **Step 4: Run Arbitrum One**

```bash
npm run prepare:provider:arbitrum-one
npm run call:provider:arbitrum-one -- --dry-run
npm run call:provider:arbitrum-one
```

Use canonical Arbitrum USDC or the explicitly allowlisted USDT-compatible token and record its six-decimal raw value.

Result: transaction `0x000000000000000000000000000000000000000000000000d682130702265f44` succeeded against Router `0x0000000000000000000000005dc708e8e59868b7`; nonce advanced `5 → 6`, and the `0.01 USDC` payment plus `0.001 USDC` token fee reconciled exactly.

- [x] **Step 5: Run Ethereum Mainnet last**

```bash
npm run prepare:provider:ethereum
npm run call:provider:ethereum -- --dry-run
npm run call:provider:ethereum
```

Use the smallest useful canonical Ethereum token amount and confirm the relayer ETH balance again immediately before broadcast.

Result: transaction `0x00000000000000000000000000000000000000000000000078743ca50493dec5` succeeded against Router `0x0000000000000000000000005dc708e8e59868b7`; nonce advanced `3 → 4`, and the `0.001 USDC` payment plus `0.001 USDC` token fee reconciled exactly.

- [x] **Step 6: Reconcile every receipt**

For each chain assert:

```text
receipt.status == success
tx.from == configured sponsor/relayer
tx.to == configured SponsorRouter
SponsoredCallForwarded == 1
SponsoredExecuted == 1
NonceUsed == 1
CallExecuted >= 1
FeePaid == 1 when total token fee is positive
sponsored nonce after == sponsored nonce before + 1
merchant token delta == payment amount
feeReceiver token delta == gasFeeAmount + serviceFeeAmount
user token delta == payment amount + gasFeeAmount + serviceFeeAmount
relayer paid native transaction gas
```

- [x] **Step 7: Record contract-only scope**

The report must state that a passing result proves:

```text
EIP-7702 authorization accepted
EIP-712 SponsoredCall signature accepted
SponsorRouter and delegated account executed
policy and fee-token enforcement worked
token transfers and nonce reconciled
```

It must also state that no GM Wallet quote, execution, platform balance, sponsor bill, rebate, push, or History behavior was tested.

- [x] **Step 8: Commit**

```bash
git add evm-7702-sponsored/reports/four-chain-contract-acceptance-2026-07-28.md
git commit -m "docs: record four-chain contract acceptance"
```

---

## Phase 2 — Deferred Backend Integration

Start this phase only after all Phase 1 gates pass. The backend may then add the four chains without changing the accepted contract signing domain, request fields, calls hash, authorization target, router ABI, or event accounting.

### Backend Handoff Contract

The later backend integration must:

1. Add `eth`, `bsc`, `bsc-testnet`, and `arb1` chain configuration using the Phase 1 accepted registry, implementation, router, sponsor, token, and policy values.
2. Return those accepted addresses through `GET /v1/sponsor/{chain}/config`.
3. Build quotes through `POST /v1/sponsor/{chain}/preview` without signing, broadcasting, freezing, or billing.
4. Validate quote ownership, expiry, account, merchant, payment token, amount, calls, and calls hash before execute.
5. Validate the EIP-712 user signature and EIP-7702 authorization chain ID, implementation, nonce, signature, and executor.
6. Submit `SponsorRouter.executeSponsored` through the configured relayer/provider and persist its provider ID immediately.
7. Poll to a terminal `settled` or `failed` state; never leave a paid execution permanently `frozen`.
8. Reconcile the receipt tx hash, status, contract events, sponsored nonce, platform balance, frozen balance, sponsor bill, charged amount, and refunds.
9. Advertise a chain through `GET /v1/capabilities/sponsor-chains` only after its config, provider, signer, RPC, and settlement worker pass readiness checks.
10. Emit the existing settled sponsor-billing event so `neo-invite-server` can process rebate and campaign logic without understanding EIP-7702 payloads.

### Task 4: Build the Authenticated GM Wallet EVM Harness

**Files:**
- Create: `../wallet-app-tests/evm-sponsor-7702.ts`
- Create: `../wallet-app-tests/evm-sponsor-7702-cases.ts`
- Modify: `../wallet-app-tests/package.json`

**Interfaces:**
- Consumes: existing auth/device signer fixtures, `/v1/capabilities/sponsor-chains`, and `/v1/sponsor/{chain}/*`.
- Produces: one JSON and one Markdown report per run with redacted signatures and complete financial/on-chain evidence.

- [ ] **Step 1: Define chain metadata**

```ts
type EvmSponsorChain = "bsc" | "bsc-testnet" | "eth" | "arb1";

const CHAINS = {
  bsc: { chainId: 56, rpcEnv: "BSC_RPC_URL" },
  "bsc-testnet": { chainId: 97, rpcEnv: "BSC_TESTNET_RPC_URL" },
  eth: { chainId: 1, rpcEnv: "ETH_RPC_URL" },
  arb1: { chainId: 42161, rpcEnv: "ARBITRUM_ONE_RPC_URL" },
} as const;
```

- [ ] **Step 2: Implement read-only capability/config checks**

For each chain:

1. Require the chain in `GET /v1/capabilities/sponsor-chains`.
2. Fetch `GET /v1/sponsor/{chain}/config`.
3. Compare `account_implementation`, `sponsor_router`, `policy_registry`, and `sponsor_address` to the deployment preflight.
4. Verify all returned addresses have code and the sponsor is allowlisted.

If a chain is omitted from capabilities, mark `BLOCKED_NOT_ENABLED`; do not call preview or execute.

- [ ] **Step 3: Implement payload creation**

Construct one ERC-20 transfer, compute `callsHash`, read the sponsored nonce, sign the `SponsoredCall` EIP-712 data, then sign the EIP-7702 authorization with:

```ts
{
  chainId,
  contractAddress: config.account_implementation,
  executor: config.sponsor_address,
}
```

- [ ] **Step 4: Add dry-run mode**

Dry-run may call capability, config, balances, nonce, and preview. It must stop before execute and assert preview created no execution, bill, freeze, nonce change, or token movement.

- [ ] **Step 5: Add paid gates**

Require both:

```text
EVM_7702_RUN=1
EVM_7702_RUN_<CHAIN>=1
```

Also require a per-chain maximum platform charge and payment amount so a misconfigured decimal cannot spend an unbounded amount.

- [ ] **Step 6: Add package commands**

```json
{
  "evm:7702:preflight": "tsx wallet-tests/evm-sponsor-7702.ts --mode preflight",
  "evm:7702:negative": "tsx wallet-tests/evm-sponsor-7702.ts --mode negative",
  "evm:7702:armed": "tsx wallet-tests/evm-sponsor-7702.ts --mode armed"
}
```

- [ ] **Step 7: Commit**

```bash
git add wallet-tests/evm-sponsor-7702.ts wallet-tests/evm-sponsor-7702-cases.ts package.json
git commit -m "test: add EIP-7702 sponsor regression harness"
```

---

### Task 5: Add Free API and Signature Rejection Cases

**Files:**
- Modify: `../wallet-app-tests/evm-sponsor-7702-cases.ts`

**Interfaces:**
- Consumes: a valid preview quote and a valid locally generated payload.
- Produces: rejection evidence proving validation happens before freeze and billing.

- [ ] **Step 1: Test unsupported/disabled chain**

Call config/preview only for a chain omitted from capabilities and assert it is rejected or skipped as disabled; never call execute.

- [ ] **Step 2: Test quote ownership and expiry**

Submit another user’s quote and an expired quote. Assert HTTP/business rejection with no execution or balance change.

- [ ] **Step 3: Test mutated calls**

Change target, amount, calldata, call order, and `callsHash` one field at a time. Each must reject before freeze.

- [ ] **Step 4: Test EIP-712 mutations**

Mutate account, sponsored nonce, deadline, sponsor, fee token, fee amounts, fee receiver, and verifying chain/domain one at a time.

- [ ] **Step 5: Test EIP-7702 authorization mutations**

Mutate authorization chain ID, implementation address, executor, authorization nonce, and signature.

- [ ] **Step 6: Test amount and balance boundaries**

Cover zero payment, one smallest unit, exact token balance, balance-minus-one, insufficient token balance, and a decimal mismatch input.

- [ ] **Step 7: Test platform controls**

Cover auto-sponsor disabled, insufficient platform balance, and duplicate execute of the same quote.

- [ ] **Step 8: Assert rejection invariants**

Every rejected case must have:

```text
execution_id absent
sponsored nonce unchanged
platform balance unchanged
user and merchant token balances unchanged
no new sponsor bill
```

- [ ] **Step 9: Commit**

```bash
git add wallet-tests/evm-sponsor-7702-cases.ts
git commit -m "test: cover EIP-7702 sponsor rejection paths"
```

---

### Task 6: Run Four Backend-Integrated Paid Happy Paths Serially

**Files:**
- Modify: `../wallet-app-tests/docs/EVM代付验收报告-2026-07-28.md`

**Interfaces:**
- Consumes: passing contract tests, deployment preflight, API preflight, and explicit paid-run authorization.
- Produces: four terminal executions with reconciled chain and platform evidence.

- [ ] **Step 1: Run BSC Testnet**

Expected: `stage=settled`, receipt success, sponsored nonce `+1`, merchant token delta equals payment, and settlement reconciles.

- [ ] **Step 2: Run BSC Mainnet**

Use the configured canonical BSC token and a minimal amount. Wait for terminal status before any retry.

- [ ] **Step 3: Run Arbitrum One**

Do not start until `arb1` appears in capabilities and the live OpenAPI enum/reference client supports it.

- [ ] **Step 4: Run Ethereum Mainnet**

Run last because its relayer gas is the most expensive. Use a strict maximum charge and smallest useful token amount.

- [ ] **Step 5: Verify each on-chain result**

For every tx assert:

```text
receipt.status == success
tx.from == configured sponsor/relayer
tx.to == configured SponsorRouter
SponsoredCallForwarded == 1
SponsoredExecuted == 1
NonceUsed == 1
merchant token delta == payment amount
feeReceiver token delta == configured on-chain fee
user token delta == payment + on-chain fee
```

- [ ] **Step 6: Verify GM Wallet accounting**

Assert the API execution’s `tx_hash` equals the on-chain tx, the sponsor bill is settled, `platform_balance_before - platform_balance_after == settlement.charged`, and frozen balance returns to zero.

- [ ] **Step 7: Commit the report**

```bash
git add docs/EVM代付验收报告-2026-07-28.md
git commit -m "docs: record four-chain EIP-7702 acceptance results"
```

---

### Task 7: Verify Invite/Rebate Downstream Consumption

**Files:**
- Modify: `../wallet-app-tests/docs/EVM代付验收报告-2026-07-28.md`

**Interfaces:**
- Consumes: at least one settled EVM sponsor bill from a bound downline.
- Produces: proof that `neo-invite-server` ingests the EVM billing exactly once and computes the configured rebate correctly.

- [ ] **Step 1: Select one settled EVM bill**

Use a downline account with a known active referrer and rebate rate.

- [ ] **Step 2: Verify source ingestion**

Confirm the bill’s `execution_id`, chain, tx hash, settled status, actual items, and event ID appear once in Invite views.

- [ ] **Step 3: Verify rebate math**

Assert:

```text
eligible resource fee × rate_ppm / 1_000_000 == rebate amount
```

Also assert one rebate event, one ledger credit, and one balance increment.

- [ ] **Step 4: Verify idempotency**

Re-read after processor retries and assert no duplicate rebate, ledger, campaign count, or coupon activation.

- [ ] **Step 5: Commit**

```bash
git add docs/EVM代付验收报告-2026-07-28.md
git commit -m "docs: record EVM sponsor rebate verification"
```

---

## Phase 3 — Deferred Frontend SDK Wrapper

Start this phase after the backend config/preview/execute contract is stable. The SDK wraps contract payload construction and signing for web/mobile clients; it does not replace the backend or relayer.

### Task 8: Package a Frontend-Safe EIP-7702 Sponsor Client

**Files:**
- Modify: `evm-7702-sponsored/sdk/chains.ts`
- Modify: `evm-7702-sponsored/sdk/index.ts`
- Modify: `evm-7702-sponsored/sdk/types.ts`
- Create: `evm-7702-sponsored/sdk/backend-client.ts`
- Create: `evm-7702-sponsored/sdk/browser.ts`
- Create: `test/EIP7702FrontendSdk.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: backend EIP-7702 config/quote responses and an injected EIP-1193/viem wallet client controlled by the user.
- Produces: a browser-safe client that builds calls, requests signatures, serializes JSON payloads, submits execute, and polls status without ever receiving a sponsor private key.

- [ ] **Step 1: Add all four backend chain shortnames**

```ts
export type BackendEvmChain = "eth" | "bsc" | "bsc-testnet" | "arb1";

export const BACKEND_EVM_CHAINS = {
  eth: { chainId: 1, sdkChainKey: "ethereum" },
  bsc: { chainId: 56, sdkChainKey: "bsc" },
  "bsc-testnet": { chainId: 97, sdkChainKey: "bscTestnet" },
  arb1: { chainId: 42161, sdkChainKey: "arbitrumOne" },
} as const;
```

- [ ] **Step 2: Define the frontend client API**

```ts
export type Eip7702SponsorClient = {
  getConfig(chain: BackendEvmChain): Promise<Eip7702BackendConfig>;
  preview(input: Eip7702PreviewInput): Promise<Eip7702Quote>;
  prepareExecution(input: PrepareFrontendExecutionInput): Promise<Eip7702ExecuteBody>;
  execute(chain: BackendEvmChain, body: Eip7702ExecuteBody): Promise<Eip7702ExecutionReceipt>;
  getExecution(chain: BackendEvmChain, executionId: string): Promise<Eip7702ExecutionStatus>;
};
```

- [ ] **Step 3: Keep signing and broadcasting responsibilities separate**

`prepareExecution()` must:

1. Verify the connected wallet chain ID.
2. Build the ERC-20 business calls.
3. Compute `callsHash`.
4. Read or accept the current sponsored nonce.
5. Sign the `SponsoredCall` EIP-712 data with the user wallet.
6. Sign the EIP-7702 authorization for `config.account_implementation` with `config.sponsor_address` as executor.
7. Return JSON-safe strings.

It must not call a relayer provider, hold a relayer key, pay native gas, or call `SponsorRouter.executeSponsored` directly.

- [ ] **Step 4: Validate backend config before signing**

Reject before opening the wallet signature UI when:

```text
config chain does not match selected chain
account implementation is zero/invalid
sponsor address is zero/invalid
sponsor router is zero/invalid
quote is expired
quote account/token/merchant/calls do not match current form state
backend fee fields exceed the accepted quote
```

- [ ] **Step 5: Add browser-safe dependency injection**

`createEip7702SponsorClient()` must accept:

```ts
type SponsorClientOptions = {
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  getAuthHeaders: (request: { method: string; url: string; body?: string }) => Promise<Record<string, string>>;
};
```

This keeps Bearer/device signing in the host app and keeps the contract SDK independent from GM Wallet authentication storage.

- [ ] **Step 6: Add SDK unit tests**

Cover:

```text
four chain mappings
USDT/USDC decimals and addresses
callsHash determinism
JSON bigint serialization
wrong wallet chain rejection
wrong backend config rejection
quote mutation rejection
EIP-712 domain values
EIP-7702 implementation and executor values
no sponsor private key in public inputs or outputs
execute/status request paths
```

- [ ] **Step 7: Add package commands**

```json
{
  "test:sdk": "hardhat test nodejs --no-compile -- test/EIP7702FrontendSdk.ts",
  "check:sdk": "tsc --noEmit"
}
```

- [ ] **Step 8: Run the SDK verification**

```bash
npm run check:sdk
npm run test:sdk
npm test
```

Expected: SDK tests and all contract tests pass.

- [ ] **Step 9: Commit**

```bash
git add evm-7702-sponsored/sdk/chains.ts evm-7702-sponsored/sdk/index.ts evm-7702-sponsored/sdk/types.ts evm-7702-sponsored/sdk/backend-client.ts evm-7702-sponsored/sdk/browser.ts test/EIP7702FrontendSdk.ts package.json
git commit -m "feat: add frontend EIP-7702 sponsor client"
```
