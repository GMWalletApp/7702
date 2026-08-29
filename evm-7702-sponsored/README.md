# EVM 7702 Sponsored Payment Package

This package is the first integration bundle for the EIP-7702 EVM sponsored payment
flow in this repository. A sponsor / relayer pays native gas. The current
`platform_subsidized` policy charges the user no gas or service fee; same-transaction
USDT/USDC repayment remains implemented but is disabled by the five-chain zero limits.

The first version supports only:

- Ethereum Mainnet
- BSC Mainnet
- Arbitrum One
- Polygon PoS

Each chain supports only USDT and USDC. BSC Testnet is intentionally excluded because it
does not have official / canonical USDT and USDC. This package does not mix mock tokens
into the mainnet integration registry.

Fee tokens must not be hard-coded in product logic. Use `sdk/chains.ts` as the
chain-token config registry, and keep the on-chain policy registry allowlist in sync.

`enabled=true` means the SDK can generate a payload for the chain-token pair. It does not
mean the token is fully production-canary verified. Any token with `verified=false` or
`needsCanary=true` still requires registry allowlisting, supplier / relayer endpoint
setup, real small-value canary, and reconciliation before production broadcast.

## Files

```text
evm-7702-sponsored/
├── README.md
├── abi/
│   ├── SponsorRouter.json
│   ├── SponsoredAccountEvents.json
│   └── ERC20Transfer.json
├── sdk/
│   ├── index.ts
│   ├── chains.ts
│   ├── types.ts
│   └── example.ts
├── docs/
│   ├── frontend-flow.md
│   ├── backend-storage.md
│   ├── indexer.md
│   ├── self-relayer-frontend-integration.md
│   ├── self-relayer-backend-integration.md
│   └── internal/
│       └── self-relayer-rollout-history.md
├── reports/
│   ├── polygon-mainnet-deployment-2026-08-11.md
│   ├── five-chain-pure-subsidy-policy-2026-08-11.md
│   └── polygon-pure-subsidy-canary-2026-08-11.md
└── examples/
    └── payload.example.json
```

The frontend and backend integration guides contain only the current contract and
runtime requirements. Deployment history, canary evidence, incident notes, and rollout
milestones are kept in `docs/internal/` and `reports/`.

Operational identifiers in public examples and reports are anonymized. Treat
wallet addresses, contract deployment addresses, transaction hashes, and
provider identifiers in those files as placeholders. Canonical token metadata
used by the SDK remains in `sdk/chains.ts`.

## Support Matrix

| chainKey | chainId | token | tokenAddress | decimals | enabled | verified | needsCanary | note |
| --- | ---: | --- | --- | ---: | --- | --- | --- | --- |
| ethereum | 1 | USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 | true | true | false | Ethereum mainnet canonical USDT. |
| ethereum | 1 | USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 | true | true | false | Ethereum mainnet canonical USDC. |
| bsc | 56 | USDT | `0x55d398326f99059fF775485246999027B3197955` | 18 | true | true | false | BSC mainnet Binance-Peg BSC-USD / USDT-compatible token. |
| bsc | 56 | USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 | true | true | false | BSC mainnet Binance-Peg USDC. |
| arbitrumOne | 42161 | USDT | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6 | true | true | false | Arbitrum One USDT-compatible token. On-chain symbol may display as USD₮0 / USDT0. |
| arbitrumOne | 42161 | USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 | true | true | false | Arbitrum One native USDC. |
| polygon | 137 | USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 6 | true | true | false | Polygon PoS native USDC. |

`verified` and `needsCanary` are release metadata. Product runtime availability must
still come from the backend capability response.

## SDK

The SDK is a minimal payload builder. It does not touch private keys directly and does
not broadcast transactions. It uses a viem `walletClient` for user signatures.

Main exports:

- `buildTokenTransferCall`
- `hashCall`
- `hashCalls`
- `buildSponsoredCallRequest`
- `signSponsoredCall`
- `sign7702Authorization`
- `encodeExecuteSponsored`
- `prepareSponsoredPayload`
- `getSupportedTokenConfig`
- `assertSupportedToken`

`prepareSponsoredPayload` returns:

```text
chainId
chainKey
to
value
data
request
calls
userSignature
authorizationList
context
```

All bigint values are serialized as decimal strings in the returned payload.

## Ops-Only Scripts

The scripts in `evm-7702-sponsored/scripts/` provide deployment checks,
allowlist administration, canary planning, and the self-relayer canary runner.
The operations that can write chain state or broadcast transactions are
ops-only:

- `apply-fee-token-whitelist.ts`
- `run-self-relayer-canary.ts`

They are guarded by explicit safety switches. The allowlist script requires an
explicit confirmation before writing. The canary runner supports `--dry-run` and
blocks live mainnet targets unless `--allow-mainnet` is explicitly supplied.

To execute real whitelist writes, an operator must set:

```text
CONFIRM_APPLY_FEE_TOKEN_WHITELIST=true
```

Preview the complete self-relayer canary without broadcasting:

```text
npm run canary:self-relayer -- --dry-run
```

Run live mainnet canaries only after reviewing the preview:

```text
npm run canary:self-relayer -- --allow-mainnet
```

Never print or share private keys, API keys, API secrets, or full `.env` contents when
using these scripts.

## Production Gates

Before real production broadcast, Neo backend must verify:

- token exists in `sdk/chains.ts`
- token is enabled
- policy registry allows the token and sponsor
- supplier / relayer endpoint is configured for the chain
- simulation succeeds
- user balance covers `paymentAmount + gasFeeAmount + serviceFeeAmount`
- sponsor native balance is above threshold
- idempotency keys prevent duplicate submission
- canary status is complete before changing any token to `verified=true`
- receipt reconciliation passes after the transaction lands

## Handoff Summary

Current first version covers Ethereum Mainnet, BSC Mainnet, Arbitrum One, and Polygon
PoS. Each chain configures only the stablecoins listed in the support matrix. The SDK handles frontend signing and outputs a
payload; it does not broadcast. Neo backend owns storage, relayer submission, scanning,
reconciliation, and alerting. Indexing starts from `SponsorRouter.SponsoredCallForwarded`
and then parses the full receipt. Product availability is driven by backend capability;
production rollout must keep per-chain monitoring, limits, and reconciliation gates
enabled. BSC Testnet is not
included in this round because it has no official USDT / USDC and would require dev-only
mock token configuration later.
