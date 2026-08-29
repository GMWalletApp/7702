# Frontend Flow

The frontend uses the SDK to build a signed payload. It does not broadcast the sponsored
transaction directly.

## Flow

1. Read `chainId` from the connected wallet and ask the user to choose `USDT` or `USDC`.
2. Call `getSupportedTokenConfig(chainId, tokenSymbol)` or `assertSupportedToken`.
3. Show the token address, decimals, `verified`, and `needsCanary` state from the config.
4. Request a backend quote containing `feeToken`, `gasFeeAmount`,
   `serviceFeeAmount`, `feeReceiver`, `sponsorAddress`, `sponsorRouter`, and
   `accountImplementation`.
5. Build business calls. The minimal SDK helper builds one ERC20 `transfer` from the
   user account to the merchant.
6. Read the user's current sponsored nonce from the delegated account when code exists;
   otherwise use `0` for the first sponsored request.
7. Build the `SponsoredCall` request with account, nonce, deadline, sponsor, fee token,
   fee amounts, fee receiver, and calls hash.
8. Ask the user wallet to sign EIP-712 `SponsoredCall`.
9. Ask the user wallet to sign the EIP-7702 authorization for `accountImplementation`
   with the sponsor/relayer as executor.
10. Submit the SDK payload to the application backend.
11. Backend submits through the self-operated relayer.
12. Poll order status or wait for backend push updates.

## SDK Usage

```ts
import { prepareSponsoredPayload } from "./sdk/index.js";

const payload = await prepareSponsoredPayload({
  chainId,
  tokenSymbol: "USDC",
  userAddress,
  sponsorAddress,
  merchantAddress,
  feeReceiver,
  sponsorRouter,
  accountImplementation,
  paymentAmount,
  gasFeeAmount,
  serviceFeeAmount,
  nonce,
  deadline,
  walletClient,
});
```

All bigint fields in the returned payload are JSON-safe strings. The `data` field is the
encoded `SponsorRouter.executeSponsored(request, calls, userSignature)` calldata.

`verified=false` or `needsCanary=true` does not block payload generation. The frontend
must surface that state only as operational readiness metadata; backend production
submission must still be gated by registry allowlisting, provider endpoint setup,
small-value canary, and reconciliation.
