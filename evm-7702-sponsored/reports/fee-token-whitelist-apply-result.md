# Fee Token Whitelist Apply Result

Generated at: 2026-06-30T10:04:17.163Z

This report records owner-signed registry writes for missing fee token whitelist entries. It does not imply production canary verification is complete.

| chainKey | chainId | policyRegistry | registryOwner | signerAddress | tokenSymbolConfigured | tokenAddress | onchainSymbol | onchainDecimals | beforeIsSupportedFeeToken | afterIsSupportedFeeToken | txHash | blockNumber | gasUsed | status | note |
| --- | ---: | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | ---: | ---: | --- | --- |
| ethereum | 1 | 0x00000000000000000000000057f71eb4fbe79dd9 | 0x000000000000000000000000ef303ac085f1e696 | 0x000000000000000000000000ef303ac085f1e696 | USDT | 0xdAC17F958D2ee523a2206206994597C13D831ec7 | USDT | 6 | false | true | 0x000000000000000000000000000000000000000000000000cc5607d8aed1818a | 25429774 | 48367 | submitted | Whitelist write succeeded. This does not mark SDK verified=true and does not replace small-value canary. |
| bsc | 56 | 0x000000000000000000000000ca848390f7e66b59 | 0x000000000000000000000000ef303ac085f1e696 | 0x000000000000000000000000ef303ac085f1e696 | USDC | 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d | USDC | 18 | false | true | 0x0000000000000000000000000000000000000000000000001ab5a224980e6b18 | 107233716 | 48367 | submitted | Whitelist write succeeded. This does not mark SDK verified=true and does not replace small-value canary. |
| arbitrumOne | 42161 | 0x000000000000000000000000ca848390f7e66b59 | 0x000000000000000000000000ef303ac085f1e696 | 0x000000000000000000000000ef303ac085f1e696 | USDT | 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9 | USD₮0 | 6 | false | true | 0x000000000000000000000000000000000000000000000000d8ed262759ec66fd | 478888832 | 48539 | submitted | Whitelist write succeeded. This does not mark SDK verified=true and does not replace small-value canary. Arbitrum on-chain symbol is USDt0 / USDT0; treat as USDT-compatible. |
