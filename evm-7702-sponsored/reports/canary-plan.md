# Fee Token Canary Plan

Generated at: 2026-06-30T13:05:38.716Z

Read-only preflight. This report checks registry, router, account implementation, fee token code, whitelist state, sponsor allowlist, fee receiver, fee policy, and user token balance. It does not broadcast transactions and does not call registry write methods.

| chainKey | chainId | tokenSymbol | tokenAddress | onchainSymbol | decimals | sponsor | router | registry | feeReceiver | paymentAmount | gasFeeAmount | serviceFeeAmount | totalRequiredAmount | userBalance | preflightStatus | recommendedAction |
| --- | ---: | --- | --- | --- | ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| ethereum | 1 | USDT | 0xdAC17F958D2ee523a2206206994597C13D831ec7 | USDT | 6 | 0x0000000000000000000000007c7f9f65210f707a | 0x0000000000000000000000008f4ccd74444aac5d | 0x00000000000000000000000057f71eb4fbe79dd9 | 0x0000000000000000000000006627860470681dea | 1000 | 1000 | 0 | 2000 | 498000 | PASS | READY_FOR_MANUAL_CANARY |
| bsc | 56 | USDC | 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d | USDC | 18 | 0x000000000000000000000000e200d8ec4fa142c5 | 0x00000000000000000000000072111f5ddfc88a71 | 0x000000000000000000000000ca848390f7e66b59 | 0x0000000000000000000000006627860470681dea | 1000000000000000 | 1000000000000000 | 0 | 2000000000000000 | 898000000000000000 | PASS | READY_FOR_MANUAL_CANARY |
| arbitrumOne | 42161 | USDT | 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9 | USD₮0 | 6 | 0x000000000000000000000000b2d77e0508356ea5 | 0x00000000000000000000000072111f5ddfc88a71 | 0x000000000000000000000000ca848390f7e66b59 | 0x0000000000000000000000006627860470681dea | 100000 | 10000 | 0 | 110000 | 390000 | PASS | READY_FOR_MANUAL_CANARY |

## ethereum USDT

- user: `0x0000000000000000000000007741ac3b13402f19`
- accountImplementation: `0x0000000000000000000000007f6e04fe6180d1e7`
- expectedDecimals: `6`
- isSupportedFeeToken: `true`
- isSponsorAllowed: `true`
- feePolicyAllowsAmounts: `true`
- userBalanceFormatted: `0.498`
- feePolicy: `{"maxGasFeeAmount":"5000","maxServiceFeeAmount":"0","maxTotalFeeAmount":"5000","maxCalls":"10"}`
- note: This is preflight only; no transaction was broadcast and SDK verified flags were not changed.

## bsc USDC

- user: `0x0000000000000000000000007741ac3b13402f19`
- accountImplementation: `0x0000000000000000000000004d9bca433fc66f62`
- expectedDecimals: `18`
- isSupportedFeeToken: `true`
- isSponsorAllowed: `true`
- feePolicyAllowsAmounts: `true`
- userBalanceFormatted: `0.898`
- feePolicy: `{"maxGasFeeAmount":"5000000000000000","maxServiceFeeAmount":"0","maxTotalFeeAmount":"5000000000000000","maxCalls":"10"}`
- note: This is preflight only; no transaction was broadcast and SDK verified flags were not changed.

## arbitrumOne USDT

- user: `0x0000000000000000000000007741ac3b13402f19`
- accountImplementation: `0x0000000000000000000000004d9bca433fc66f62`
- expectedDecimals: `6`
- isSupportedFeeToken: `true`
- isSponsorAllowed: `true`
- feePolicyAllowsAmounts: `true`
- userBalanceFormatted: `0.39`
- feePolicy: `{"maxGasFeeAmount":"50000","maxServiceFeeAmount":"0","maxTotalFeeAmount":"50000","maxCalls":"10"}`
- note: This is preflight only; no transaction was broadcast and SDK verified flags were not changed. Arbitrum on-chain symbol may display as USDt0 / USDT0; business config treats it as USDT-compatible.
