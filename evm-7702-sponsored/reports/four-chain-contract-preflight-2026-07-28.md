# EIP-7702 Four-Chain Contract Preflight — 2026-07-28

## Scope

This report covers local contract tests, deployment verification, balance checks, payload construction, dry-runs, and live Router migration/canary evidence for:

- BSC Testnet (`97`)
- BSC Mainnet (`56`)
- Arbitrum One (`42161`)
- Ethereum Mainnet (`1`)

All four chains were migrated to the current guarded Router and exercised through live legacy third-party relayer canaries.

## Local contract result

| Check | Result |
| --- | --- |
| Solidity compilation | ✅ PASS |
| Node.js contract, preflight, migration, request, and simulation-state tests | ✅ 37/37 PASS |
| EIP-712 wrong-chain and wrong-contract rejection | ✅ PASS |
| Fee and call-count boundaries | ✅ PASS |
| Atomic rollback | ✅ PASS |
| No-return ERC-20 compatibility | ✅ PASS |
| Reentrant account entry attempts | ✅ BLOCKED |
| Nonzero `msg.value` sent to `SponsorRouter` | ✅ Rejected by the current source |

## Deployed contract readback

| Chain | RPC chain ID | Registry | Account implementation | Sponsor/token policy | Deployed Router vs current source |
| --- | ---: | --- | --- | --- | --- |
| BSC Testnet | 97 | ✅ code/config match | ✅ code/config match | ✅ enabled | ✅ current guarded Router |
| BSC | 56 | ✅ code/config match | ✅ code/config match | ✅ enabled | ✅ current guarded Router |
| Arbitrum One | 42161 | ✅ code/config match | ✅ code/config match | ✅ enabled | ✅ current guarded Router |
| Ethereum | 1 | ✅ code/config match | ✅ code/config match | ✅ enabled | ✅ current guarded Router |

All four Registries are unpaused. Each configured Router and Account Implementation points to the expected Registry. Each configured relayer is allowlisted and each selected fee token is supported.

All four deployed Routers now match commit `18bf57c` and reject unexpected native value.

## Dry-run readiness

Common test identities:

```text
user:        0x0000000000000000000000007741ac3b13402f19
merchant:    0x000000000000000000000000727d326c544b07bc
feeReceiver: 0x0000000000000000000000006627860470681dea
```

The three destinations are distinct.

| Chain | Token | Payment | Token fee | Required | User balance | Relayer native balance | Dry-run |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| BSC Testnet | test token | 0.1 | 0.001 | 0.101 | 99.493 | 0.499707062 tBNB | ✅ PASS |
| BSC | USDT | 0.001 | 0.001 | 0.002 | 1.498 | 0.001316220008186867 BNB | ✅ PASS |
| Arbitrum One | USDC | 0.01 | 0.001 | 0.011 | 0.065 | 0.000986774267877908 ETH | ✅ PASS |
| Ethereum | USDC | 0.001 | 0.001 | 0.002 | 0.33635 | 0.001737079437205484 ETH | ✅ PASS |

Arbitrum's repository default was `0.1 + 0.01 USDC`, which exceeded the current `0.065 USDC` user balance. The preflight used one-run overrides of `0.01 + 0.001 USDC`; no tracked configuration was changed.

## BSC Testnet guarded Router migration

| Evidence | Value |
| --- | --- |
| Registry | `0x000000000000000000000000c64f55a7740cef97` |
| Previous Router | `0x000000000000000000000000ab6da1f6566be46d` |
| New guarded Router | `0x000000000000000000000000c56f61bc69930ed6` |
| Router deployment tx | `0x00000000000000000000000000000000000000000000000019c44bac9b535ffd` |
| Router deployment block | `121766632` |
| Registry `setRouter` tx | `0x00000000000000000000000000000000000000000000000046e16e500232cdfd` |
| Registry `setRouter` block | `121766651` |
| Post-migration bytecode/config preflight | ✅ PASS |

The legacy provider contract method remained usable. Its execute contract accepted a per-request `contractAddress`; all four call scripts set it to the payload's current Router, so a Router migration did not require a new method ID.

## BSC Testnet live canary

| Evidence | Value |
| --- | --- |
| Legacy provider transaction ID | `00000000-0000-4000-8000-000000000000` |
| Transaction hash | `0x000000000000000000000000000000000000000000000000d21172f8d36e3c8b` |
| Block | `121768018` |
| Receipt | ✅ `success` |
| Transaction from | `0x000000000000000000000000e649e11b774e7d8b` |
| Transaction to | `0x000000000000000000000000c56f61bc69930ed6` |
| Gas used | `146496` |
| Sponsored nonce | `7 → 8` |
| Contract events | `SponsoredCallForwarded=1`, `FeePaid=1`, ERC-20 `Transfer=2` |
| User token delta | `-0.101` |
| Merchant token delta | `+0.1` |
| Fee receiver token delta | `+0.001` |
| Accounting | ✅ exact match |

This proves the current BSC Testnet Router, EIP-7702 authorization, EIP-712 sponsored request, policy enforcement, token transfers, sponsored nonce, and legacy provider broadcast path worked together.

## BSC Testnet live-contract boundary matrix

The following cases were executed with read-only `eth_call` simulation against the new deployed Router:

| Case | Result |
| --- | --- |
| Valid sponsored request | ✅ accepted |
| Nonzero native value | ✅ `UnexpectedNativeValue` |
| Non-allowlisted sender | ✅ `NotSponsor` |
| Request sponsor differs from sender | ✅ `InvalidSponsor` |
| Gas fee above policy | ✅ `GasFeeTooHigh` |
| Unsupported fee token | ✅ `UnsupportedFeeToken` |
| Wrong fee receiver | ✅ `InvalidFeeReceiver` |
| Calls above `maxCalls` | ✅ `TooManyCalls` |
| Wrong sponsored nonce | ✅ `InvalidNonce` |
| Expired deadline | ✅ `SignatureExpired` |
| Calls differ from the signed hash | ✅ `InvalidSignature` |

No negative case was broadcast. Sponsored nonce, user token balance, merchant token balance, and fee-receiver token balance were read before and after the matrix and remained unchanged.

## BSC Mainnet guarded Router migration

| Evidence | Value |
| --- | --- |
| Registry | `0x000000000000000000000000ca848390f7e66b59` |
| Previous Router | `0x00000000000000000000000072111f5ddfc88a71` |
| New guarded Router | `0x000000000000000000000000ab2d2b5fb2e29d11` |
| Router deployment tx | `0x0000000000000000000000000000000000000000000000001b3f3e7b583f63d0` |
| Router deployment block | `112630919` |
| Router deployment gas | `938383` |
| Registry `setRouter` tx | `0x000000000000000000000000000000000000000000000000f713761a6f9d5ceb` |
| Registry `setRouter` block | `112631051` |
| Registry `setRouter` gas | `33127` |
| Post-migration bytecode/config preflight | ✅ PASS |

The configured public RPC returned HTTP `403` while querying the already-broadcast deployment receipt. The Ignition journal was inspected before any retry, the original deployment transaction was confirmed through `https://bsc-dataseed.binance.org`, and the same Ignition deployment was resumed against that RPC. No duplicate Router was deployed.

## BSC Mainnet live canary

| Evidence | Value |
| --- | --- |
| Legacy provider transaction ID | `00000000-0000-4000-8000-000000000000` |
| Legacy provider method ID | `00000000-0000-4000-8000-000000000000` |
| Transaction hash | `0x0000000000000000000000000000000000000000000000007afee67cb983ff64` |
| Block | `112631237` |
| Receipt | ✅ `success` |
| Transaction from | `0x000000000000000000000000e200d8ec4fa142c5` |
| Transaction to | `0x000000000000000000000000ab2d2b5fb2e29d11` |
| Gas used | `145348` |
| Sponsored nonce | `3 → 4` |
| Contract events | `SponsoredCallForwarded=1`, `FeePaid=1`, USDT `Transfer=2` |
| User USDT delta | `-0.002` |
| Merchant USDT delta | `+0.001` |
| Fee receiver USDT delta | `+0.001` |
| Accounting | ✅ exact match |

The canary used a `0.001 USDT` payment plus a `0.001 USDT` token fee. It proved the migrated BSC Mainnet Router, EIP-7702 authorization, EIP-712 sponsored request, policy enforcement, USDT transfers, sponsored nonce, and legacy provider broadcast path worked together.

## Arbitrum One guarded Router migration

| Evidence | Value |
| --- | --- |
| Registry | `0x000000000000000000000000ca848390f7e66b59` |
| Previous Router | `0x00000000000000000000000072111f5ddfc88a71` |
| New guarded Router | `0x0000000000000000000000005dc708e8e59868b7` |
| Router deployment tx | `0x0000000000000000000000000000000000000000000000004ce32be30555bfd3` |
| Router deployment block | `488611025` |
| Router deployment gas | `942426` |
| Registry `setRouter` tx | `0x000000000000000000000000000000000000000000000000d5987d838e482c75` |
| Registry `setRouter` block | `488611053` |
| Registry `setRouter` gas | `33370` |
| Post-migration bytecode/config preflight | ✅ PASS |

## Arbitrum One live canary

| Evidence | Value |
| --- | --- |
| Legacy provider transaction ID | `00000000-0000-4000-8000-000000000000` |
| Legacy provider method ID | `00000000-0000-4000-8000-000000000000` |
| Transaction hash | `0x000000000000000000000000000000000000000000000000d682130702265f44` |
| Block | `488611594` |
| Receipt | ✅ `success` |
| Transaction from | `0x000000000000000000000000b2d77e0508356ea5` |
| Transaction to | `0x0000000000000000000000005dc708e8e59868b7` |
| Gas used | `158965` |
| Sponsored nonce | `5 → 6` |
| Contract events | `SponsoredCallForwarded=1`, `FeePaid=1`, USDC `Transfer=2` |
| User USDC delta | `-0.011` |
| Merchant USDC delta | `+0.01` |
| Fee receiver USDC delta | `+0.001` |
| Accounting | ✅ exact match |

The canary used a `0.01 USDC` payment plus a `0.001 USDC` token fee. It proved the migrated Arbitrum One Router, EIP-7702 authorization, EIP-712 sponsored request, policy enforcement, USDC transfers, sponsored nonce, and legacy provider broadcast path worked together.

## Ethereum Mainnet guarded Router migration

| Evidence | Value |
| --- | --- |
| Registry | `0x00000000000000000000000057f71eb4fbe79dd9` |
| Previous Router | `0x0000000000000000000000008f4ccd74444aac5d` |
| New guarded Router | `0x0000000000000000000000005dc708e8e59868b7` |
| Router deployment tx | `0x000000000000000000000000000000000000000000000000e5a88676bacf8012` |
| Router deployment block | `25631559` |
| Router deployment gas | `938371` |
| Registry `setRouter` tx | `0x0000000000000000000000000000000000000000000000003ffe2a720023f606` |
| Registry `setRouter` block | `25631565` |
| Registry `setRouter` gas | `33127` |
| Post-migration bytecode/config preflight | ✅ PASS |

## Ethereum Mainnet live canary

| Evidence | Value |
| --- | --- |
| Legacy provider transaction ID | `00000000-0000-4000-8000-000000000000` |
| Legacy provider method ID | `00000000-0000-4000-8000-000000000000` |
| Transaction hash | `0x00000000000000000000000000000000000000000000000078743ca50493dec5` |
| Block | `25631574` |
| Receipt | ✅ `success` |
| Transaction from | `0x0000000000000000000000007c7f9f65210f707a` |
| Transaction to | `0x0000000000000000000000005dc708e8e59868b7` |
| Gas used | `158114` |
| Sponsored nonce | `3 → 4` |
| Contract events | `SponsoredCallForwarded=1`, `FeePaid=1`, USDC `Transfer=2` |
| User USDC delta | `-0.002` |
| Merchant USDC delta | `+0.001` |
| Fee receiver USDC delta | `+0.001` |
| Accounting | ✅ exact match |

The canary used a `0.001 USDC` payment plus a `0.001 USDC` token fee. It proved the migrated Ethereum Mainnet Router, EIP-7702 authorization, EIP-712 sponsored request, policy enforcement, USDC transfers, sponsored nonce, and legacy provider broadcast path worked together.

## Broadcast gate result

All four chains now use the guarded Router. Their Registry, Account Implementation, Router bytecode, sponsor allowlist, fee-token policy, dry-run, live receipt, events, nonce, and token balance deltas pass. The direct contract broadcast gate is closed.

## Router migration owner/gas preflight

The Registry owner matches the configured deployment signer on all four chains.

| Chain | Owner signer native balance | Safety minimum for deploy + `setRouter` | Status |
| --- | ---: | ---: | --- |
| BSC Testnet | 0.9983774849 tBNB | 0.0002093996 tBNB | ✅ Ready |
| BSC | 0.00101888493 BNB | 0.0002093996 BNB | ✅ Migrated and canary passed |
| Arbitrum One | 0.001100424280988266 ETH | 0.000042374427384 ETH | ✅ Migrated and canary passed |
| Ethereum | 0.001132035562124003 ETH | 0.000256921477582832 ETH | ✅ Migrated and canary passed |

The safety minimum is twice the estimated Router deployment plus a `setRouter` gas buffer. All four chains have completed migration and their canaries.
