# EIP-7702 Four-Chain Contract Acceptance — 2026-07-28

## Result

✅ **Contract-only acceptance passed on all four target chains.**

The current guarded `SponsorRouter`, existing `Sponsored7702Account`, `SponsorPolicyRegistry`, EIP-7702 authorization, EIP-712 request signature, policy enforcement, sponsored nonce, token payment, token fee, and legacy third-party relayer broadcast path were exercised with real minimal-value transactions.

| Chain | Chain ID | Guarded Router | Token movement | Live transaction | Result |
| --- | ---: | --- | --- | --- | --- |
| BSC Testnet | 97 | `0x000000000000000000000000c56f61bc69930ed6` | `0.1 + 0.001` test token | `0x000000000000000000000000000000000000000000000000d21172f8d36e3c8b` | ✅ PASS |
| BSC Mainnet | 56 | `0x000000000000000000000000ab2d2b5fb2e29d11` | `0.001 + 0.001 USDT` | `0x0000000000000000000000000000000000000000000000007afee67cb983ff64` | ✅ PASS |
| Arbitrum One | 42161 | `0x0000000000000000000000005dc708e8e59868b7` | `0.01 + 0.001 USDC` | `0x000000000000000000000000000000000000000000000000d682130702265f44` | ✅ PASS |
| Ethereum Mainnet | 1 | `0x0000000000000000000000005dc708e8e59868b7` | `0.001 + 0.001 USDC` | `0x00000000000000000000000000000000000000000000000078743ca50493dec5` | ✅ PASS |

In the token movement column, the first value is the merchant payment and the second value is the token fee.

## Deployment and Registry migration

| Chain | Registry | Previous Router | Guarded Router | Deploy transaction | `setRouter` transaction |
| --- | --- | --- | --- | --- | --- |
| BSC Testnet | `0x000000000000000000000000c64f55a7740cef97` | `0x000000000000000000000000ab6da1f6566be46d` | `0x000000000000000000000000c56f61bc69930ed6` | `0x00000000000000000000000000000000000000000000000019c44bac9b535ffd` | `0x00000000000000000000000000000000000000000000000046e16e500232cdfd` |
| BSC Mainnet | `0x000000000000000000000000ca848390f7e66b59` | `0x00000000000000000000000072111f5ddfc88a71` | `0x000000000000000000000000ab2d2b5fb2e29d11` | `0x0000000000000000000000000000000000000000000000001b3f3e7b583f63d0` | `0x000000000000000000000000000000000000000000000000f713761a6f9d5ceb` |
| Arbitrum One | `0x000000000000000000000000ca848390f7e66b59` | `0x00000000000000000000000072111f5ddfc88a71` | `0x0000000000000000000000005dc708e8e59868b7` | `0x0000000000000000000000000000000000000000000000004ce32be30555bfd3` | `0x000000000000000000000000000000000000000000000000d5987d838e482c75` |
| Ethereum Mainnet | `0x00000000000000000000000057f71eb4fbe79dd9` | `0x0000000000000000000000008f4ccd74444aac5d` | `0x0000000000000000000000005dc708e8e59868b7` | `0x000000000000000000000000000000000000000000000000e5a88676bacf8012` | `0x0000000000000000000000000000000000000000000000003ffe2a720023f606` |

The final four-chain readback confirms:

- Registry, Account Implementation, and Router all have deployed code.
- Deployed executable bytecode matches the current compiled artifacts.
- Every Registry points to the expected Router.
- Every Router and Account Implementation points back to the expected Registry.
- All Registries are unpaused.
- Each configured relayer is allowlisted.
- Each selected fee token is supported.

## Live transaction reconciliation

| Chain | Receipt | Router target | Sponsored nonce | Required events | User delta | Merchant delta | Fee receiver delta |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| BSC Testnet | ✅ success | ✅ match | `7 → 8` | ✅ match | `-0.101` | `+0.1` | `+0.001` |
| BSC Mainnet | ✅ success | ✅ match | `3 → 4` | ✅ match | `-0.002 USDT` | `+0.001 USDT` | `+0.001 USDT` |
| Arbitrum One | ✅ success | ✅ match | `5 → 6` | ✅ match | `-0.011 USDC` | `+0.01 USDC` | `+0.001 USDC` |
| Ethereum Mainnet | ✅ success | ✅ match | `3 → 4` | ✅ match | `-0.002 USDC` | `+0.001 USDC` | `+0.001 USDC` |

Every receipt contained exactly one `SponsoredCallForwarded`, one `FeePaid`, and two token `Transfer` events. All nonce and balance deltas matched the signed request exactly.

## Boundary coverage

The identical guarded Router source passed local and deployed-contract coverage for:

- nonzero native value rejection;
- non-allowlisted sender and mismatched sponsor rejection;
- unsupported fee token and wrong fee receiver rejection;
- gas fee and total fee policy boundaries;
- call-count boundaries;
- wrong nonce, expired deadline, invalid signature, wrong chain, and wrong verifying contract;
- invalid targets and failed inner calls;
- atomic rollback of target state, fees, nonce, and logs;
- replay protection;
- reentrant account entry blocking;
- no-return ERC-20 compatibility.

The deployed BSC Testnet Router additionally passed eleven read-only negative simulations. No negative case was broadcast, and the observed nonce and token balances remained unchanged.

## Final verification

| Command | Result |
| --- | --- |
| `BSC_RPC_URL=https://bsc-dataseed.binance.org npm run preflight:four-chain` | ✅ 4/4 chains PASS |
| `npm test -- --no-compile` | ✅ 37/37 PASS |
| `npx tsc --noEmit` | ✅ PASS |
| `git diff --check` | ✅ PASS before final report commit |
| Fresh `npm run compile` | ⚠️ Not completed: local Hardhat compiler-download mutex timed out after 60 seconds |

The compile limitation is a local tool-lock condition, not a Solidity compiler error. The Solidity artifacts used by the passing tests and bytecode preflight were compiled earlier in this work, and all four deployed Routers match those artifacts. A fresh compile should still be rerun when the external Hardhat mutex is released.

## Scope boundary

This acceptance proves only the direct contract and relayer path:

- EIP-7702 authorization was accepted.
- EIP-712 `SponsoredCall` signatures were accepted.
- `SponsorRouter` and the delegated account executed.
- Registry, sponsor, fee-token, receiver, amount, call-count, nonce, deadline, and signature policy worked.
- Token transfers, contract events, and sponsored nonce reconciled.

It does **not** prove any future GM Wallet backend or frontend integration. No GM Wallet EVM quote, preview, execution record, platform balance, frozen balance, sponsor bill, rebate, campaign, push, History, or frontend SDK behavior was tested in this phase.

The next phase is backend integration for `eth`, `bsc`, `bsc-testnet`, and `arb1`, followed by the frontend contract wrapper and real app flow validation.
