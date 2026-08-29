# Backend Storage

Neo backend owns persistence, simulation, submission, indexing, reconciliation, and
alerts. The SDK only builds a signed payload.

## Required Fields

### Base Fields

```text
id
chainId
chainKey
userAddress
sponsorAddress
routerAddress
accountImplementation
feeToken
feeTokenSymbol
feeTokenDecimals
merchantAddress
feeReceiver
```

### Amount Fields

```text
paymentAmount
gasFeeAmount
serviceFeeAmount
totalFeeAmount
totalRequiredAmount
nativeGasCost
```

Store token amounts as integer strings in the smallest unit. `nativeGasCost` is the
sponsor/relayer native token spend and should also be stored as a smallest-unit string.

### Signature Fields

```text
nonce
deadline
callsHash
payloadHash
userSignatureHash
authorizationHash / authorizationDigest
```

Store the full payload in cold/detail storage if needed, but index hashes for idempotent
submission and investigation. `payloadHash` should cover the encoded router call, request,
calls, user signature, authorization list, and chain id.

### Transaction Fields

```text
txHash
blockNumber
receiptStatus
gasUsed
effectiveGasPrice
```

### Status Fields

```text
status: created / signed / submitted / confirmed / failed / expired
failReason
retryCount
createdAt
submittedAt
confirmedAt
```

Recommended extra timestamps: `quotedAt`, `simulatedAt`, `lastScannedAt`, `failedAt`,
and `expiredAt`.

## Backend Responsibilities

Before accepting a payload for submission:

1. Validate `chainId + tokenSymbol` against `sdk/chains.ts`.
2. Reject disabled tokens.
3. Record `verified` and `needsCanary` from the SDK context.
4. Check the chain registry has the fee token allowlisted.
5. Check the sponsor is allowlisted.
6. Simulate the router call against the latest block.
7. Verify the user's fee token balance covers `totalRequiredAmount`.
8. Enforce per-user, per-merchant, per-token, and per-chain limits.
9. Deduplicate by `payloadHash`, `callsHash + nonce + userAddress`, and provider idempotency key.

For submission:

1. Submit only from an approved sponsor/relayer wallet.
2. Maintain retry state with bounded retries and deterministic idempotency keys.
3. Persist self-relayer request ids, transaction hashes, and submission responses.
4. Do not submit `verified=false` or `needsCanary=true` tokens to production traffic
   until the canary checklist is complete.

For operations:

1. Monitor sponsor native balance per chain.
2. Alert on low native balance, high revert rate, stuck submitted orders, scanner lag,
   and reconciliation mismatch.
3. Track real canary status per chain-token pair: registry whitelist, provider endpoint,
   small-value broadcast, receipt parse, merchant settlement, fee settlement, and final
   reconciliation.
