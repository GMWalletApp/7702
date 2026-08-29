# EVM 7702 Sponsored Indexer

## Event Entry

Run one indexer configuration per supported mainnet:

| chainKey | chainId | entry contract |
| --- | ---: | --- |
| ethereum | 1 | SponsorRouter |
| bsc | 56 | SponsorRouter |
| arbitrumOne | 42161 | SponsorRouter |
| polygon | 137 | SponsorRouter |

The primary entry event is:

```text
SponsoredCallForwarded(address indexed account, address indexed sponsor, bytes32 callsHash)
```

The indexer should listen to the deployed `SponsorRouter` address on each chain. After a
`SponsoredCallForwarded` log is found, use its transaction hash to load the full
transaction receipt and parse all receipt logs.

## Receipt Parsing

Parse these logs from the full receipt:

| ABI file | Events |
| --- | --- |
| `abi/SponsorRouter.json` | `SponsoredCallForwarded` |
| `abi/SponsoredAccountEvents.json` | `FeePaid`, `SponsoredExecuted`, `NonceUsed`, `CallExecuted` |
| `abi/ERC20Transfer.json` | `Transfer` |

Do not parse only the log emitted by the router. The payment transfer, fee transfer,
nonce, and account execution events are required for settlement and reconciliation.

In the EIP-7702 flow, account events may have the user's EOA as the log address. They
are not guaranteed to be emitted from the account implementation contract address. Use
the `SponsorRouter` event as the entry point, then parse the entire receipt by event
topic and expected account/request values.

## Matching Rules

Use these values to correlate a receipt with a backend order:

| Field | Source |
| --- | --- |
| `txHash` | receipt transaction hash |
| `chainId` / `chainKey` | indexer configuration |
| `account` / `userAddress` | `SponsoredCallForwarded.account` and account events |
| `sponsorAddress` | `SponsoredCallForwarded.sponsor` and `FeePaid.sponsor` |
| `callsHash` | `SponsoredCallForwarded.callsHash` and `SponsoredExecuted.callsHash` |
| `nonce` | `NonceUsed.nonce` and `SponsoredExecuted.nonce` |
| `feeToken` | `FeePaid.feeToken` and ERC20 `Transfer.address` |
| `feeReceiver` | `FeePaid.feeReceiver` and ERC20 `Transfer.to` |
| `merchantAddress` | configured payment call recipient and ERC20 `Transfer.to` |

Treat missing account events, mismatched calls hash, mismatched nonce, or an unexpected
fee token as reconciliation failures even when the receipt status is successful.

## Reconciliation

For a charged single-token payment:

```text
user token decrease = paymentAmount + gasFeeAmount + serviceFeeAmount
merchant receives   = paymentAmount
feeReceiver receives = gasFeeAmount + serviceFeeAmount
```

Concrete checks:

1. `receipt.status` must be success.
2. `SponsoredCallForwarded.account` must match the order user.
3. `SponsoredCallForwarded.sponsor` must match the order sponsor.
4. `SponsoredExecuted.callsHash` must equal the payload `callsHash`.
5. `NonceUsed.nonce` must equal the signed request nonce.
6. One ERC20 `Transfer` from user to merchant must sum to `paymentAmount`.
7. ERC20 `Transfer` from user to `feeReceiver` must sum to `gasFeeAmount + serviceFeeAmount`.
8. `FeePaid.totalFeeAmount` must equal `gasFeeAmount + serviceFeeAmount`.

For the current pure-subsidy mode (`gasFeeAmount=0` and
`serviceFeeAmount=0`), checks 7 and 8 become absence checks:

- no ERC-20 `Transfer` from the user to `feeReceiver`
- no `FeePaid` event
- user token decrease equals only the business payment amount
- Sponsor native balance pays the transaction gas and is recorded as platform cost

A one-recipient pure-subsidy payment normally has one business `Transfer`, not
the two transfers used by the older charged-path acceptance checks.

If a future payload contains multiple merchant calls, sum transfers by recipient and
compare with the backend payment allocation for each recipient.

## Operational Notes

Keep a per-chain cursor with confirmations. Reprocess receipts idempotently by
`chainId + txHash + logIndex`. Mark orders confirmed only after receipt parsing and
reconciliation pass.

Alert on failed receipts, missing expected events, fee transfer mismatches, unusually
high failure rate, sponsor native gas balance below threshold, or stale scanner cursor.
