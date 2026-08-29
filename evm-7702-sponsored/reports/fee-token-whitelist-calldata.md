# Fee Token Whitelist Calldata Plan

Generated at: 2026-06-30T09:44:24.500Z

This is a read-only preparation report. The script only reads chain state and encodes calldata for `setSupportedFeeToken(address,bool)`. It does not broadcast transactions and does not call registry write methods.

## Manual Execution Steps

1. Confirm the policy registry address for the target chain.
2. Confirm the registry owner and whether it is an EOA, multisig, or governance contract.
3. Confirm the token address, on-chain symbol, and decimals.
4. Execute the calldata through the owner EOA or create a multisig/governance proposal.
5. After execution, rerun `evm-7702-sponsored/scripts/check-fee-token-whitelist.ts`.
6. After the whitelist is confirmed, run a small-value canary for each token before production traffic.

Do not update SDK `verified=false` to `true` from this report alone. A whitelist entry only means the token can be accepted as a fee token; production canary and reconciliation are separate gates.

## Calldata

| chainKey | chainId | policyRegistry | registryOwner | tokenSymbolConfigured | tokenAddress | onchainSymbol | onchainDecimals | currentIsSupportedFeeToken | functionName | args | calldata | recommendedExecutor | note |
| --- | ---: | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| ethereum | 1 | 0x00000000000000000000000057f71eb4fbe79dd9 | 0x000000000000000000000000ef303ac085f1e696 | USDT | 0xdAC17F958D2ee523a2206206994597C13D831ec7 | USDT | 6 | false | setSupportedFeeToken | {"token":"0xdAC17F958D2ee523a2206206994597C13D831ec7","supported":true} | 0xe487dcb8000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec70000000000000000000000000000000000000000000000000000000000000001 | OWNER_EOA_CONFIRM_REQUIRED | Current registry value is false; calldata enables this fee token. Owner appears to be an EOA; owner must review and submit manually. Whitelist enablement does not mark SDK verified=true and does not replace small-value canary. |
| bsc | 56 | 0x000000000000000000000000ca848390f7e66b59 | 0x000000000000000000000000ef303ac085f1e696 | USDC | 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d | USDC | 18 | false | setSupportedFeeToken | {"token":"0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d","supported":true} | 0xe487dcb80000000000000000000000008ac76a51cc950d9822d68b83fe1ad97b32cd580d0000000000000000000000000000000000000000000000000000000000000001 | OWNER_EOA_CONFIRM_REQUIRED | Current registry value is false; calldata enables this fee token. Owner appears to be an EOA; owner must review and submit manually. Whitelist enablement does not mark SDK verified=true and does not replace small-value canary. |
| arbitrumOne | 42161 | 0x000000000000000000000000ca848390f7e66b59 | 0x000000000000000000000000ef303ac085f1e696 | USDT | 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9 | USD₮0 | 6 | false | setSupportedFeeToken | {"token":"0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9","supported":true} | 0xe487dcb8000000000000000000000000fd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb90000000000000000000000000000000000000000000000000000000000000001 | OWNER_EOA_CONFIRM_REQUIRED | Current registry value is false; calldata enables this fee token. Owner appears to be an EOA; owner must review and submit manually. Whitelist enablement does not mark SDK verified=true and does not replace small-value canary. Arbitrum on-chain symbol is USDt0 / USDT0; treat as USDT-compatible. |
