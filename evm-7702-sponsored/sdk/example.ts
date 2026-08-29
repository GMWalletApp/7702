import { parseUnits } from "viem";

import {
  assertSupportedToken,
  prepareSponsoredPayload,
  stringifySponsoredPayload,
  type SponsoredWalletClient,
} from "./index.js";

declare const walletClient: SponsoredWalletClient;

async function main() {
  const tokenConfig = assertSupportedToken(56, "USDT");

  const payload = await prepareSponsoredPayload({
    chainId: tokenConfig.chainId,
    tokenSymbol: tokenConfig.tokenSymbol,
    userAddress: "0x1111111111111111111111111111111111111111",
    sponsorAddress: "0x2222222222222222222222222222222222222222",
    merchantAddress: "0x3333333333333333333333333333333333333333",
    feeReceiver: "0x4444444444444444444444444444444444444444",
    sponsorRouter: "0x5555555555555555555555555555555555555555",
    accountImplementation: "0x6666666666666666666666666666666666666666",
    paymentAmount: parseUnits("0.001", tokenConfig.decimals),
    gasFeeAmount: parseUnits("0.001", tokenConfig.decimals),
    serviceFeeAmount: 0n,
    nonce: 0n,
    deadline: 1_780_000_000n,
    walletClient,
  });

  console.log(stringifySponsoredPayload(payload));

  if (!payload.context.verified || payload.context.needsCanary) {
    console.warn(
      "This token config can build payloads, but production broadcast still requires registry allowlisting, provider endpoint setup, a small-value canary, and reconciliation.",
    );
  }
}

void main();
