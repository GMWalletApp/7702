# Fee Token Canary Execution

Generated at: 2026-06-30T13:10:00.000Z

This report records fee-token canary execution and reconciliation. SDK verified flags were updated only after these canaries succeeded.

| chainKey | token | status | txHash | userDelta | merchantDelta | feeReceiverDelta | events | note |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |
| bsc | USDC | success | 0x000000000000000000000000000000000000000000000000df7420e26e9c8aa9 | 2000000000000000 | 1000000000000000 | 1000000000000000 | forwarded=1, sponsored=1, nonce=1, feePaid=1, call=1, transfer=2 | Canary transaction and reconciliation succeeded. |
| arbitrumOne | USDT | success | 0x000000000000000000000000000000000000000000000000bad20d67963ef728 | 110000 | 100000 | 10000 | forwarded=1, sponsored=1, nonce=1, feePaid=1, call=1, transfer=2 | Canary transaction and reconciliation succeeded. On-chain symbol is USD₮0; business config treats it as USDT-compatible. |
| ethereum | USDT | success | 0x000000000000000000000000000000000000000000000000cbd9dbf06b81d0ba | 2000 | 1000 | 1000 | forwarded=1, sponsored=1, nonce=1, feePaid=1, call=1, transfer=2 | Canary transaction and reconciliation succeeded. |
