# Fee Token Whitelist Status

Generated at: 2026-06-30T10:04:46.596Z

Read-only check. This report only uses RPC reads, `eth_call`, and `getCode`; it does not broadcast transactions or call registry write methods.

| chainKey | chainId | registry | tokenSymbolConfigured | tokenAddress | onchainSymbol | onchainDecimals | expectedDecimals | hasTokenCode | isSupportedFeeToken | isSponsorAllowed | router | feeReceiver | recommendedAction | note |
| --- | ---: | --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |
| ethereum | 1 | 0x00000000000000000000000057f71eb4fbe79dd9 | USDT | 0xdAC17F958D2ee523a2206206994597C13D831ec7 | USDT | 6 | 6 | true | true | true | 0x0000000000000000000000008f4ccd74444aac5d | 0x0000000000000000000000006627860470681dea | NEEDS_CANARY | Fee token is whitelisted, but this token still needs a real small-value canary and reconciliation before production. |
| ethereum | 1 | 0x00000000000000000000000057f71eb4fbe79dd9 | USDC | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 | USDC | 6 | 6 | true | true | true | 0x0000000000000000000000008f4ccd74444aac5d | 0x0000000000000000000000006627860470681dea | OK |  |
| bsc | 56 | 0x000000000000000000000000ca848390f7e66b59 | USDT | 0x55d398326f99059fF775485246999027B3197955 | USDT | 18 | 18 | true | true | true | 0x00000000000000000000000072111f5ddfc88a71 | 0x0000000000000000000000006627860470681dea | OK |  |
| bsc | 56 | 0x000000000000000000000000ca848390f7e66b59 | USDC | 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d | USDC | 18 | 18 | true | true | true | 0x00000000000000000000000072111f5ddfc88a71 | 0x0000000000000000000000006627860470681dea | NEEDS_CANARY | Fee token is whitelisted, but this token still needs a real small-value canary and reconciliation before production. |
| arbitrumOne | 42161 | 0x000000000000000000000000ca848390f7e66b59 | USDT | 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9 | USD₮0 | 6 | 6 | true | true | true | 0x00000000000000000000000072111f5ddfc88a71 | 0x0000000000000000000000006627860470681dea | NEEDS_CANARY | Fee token is whitelisted, but this token still needs a real small-value canary and reconciliation before production. Arbitrum on-chain symbol may display as USDt0 / USDT0; business config treats it as USDT-compatible. |
| arbitrumOne | 42161 | 0x000000000000000000000000ca848390f7e66b59 | USDC | 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 | USDC | 6 | 6 | true | true | true | 0x00000000000000000000000072111f5ddfc88a71 | 0x0000000000000000000000006627860470681dea | OK |  |
