import { getAddress, type Address } from "viem";

export type RouterMigrationPreflight = {
  actualChainId: number;
  expectedChainId: number;
  owner: Address | string;
  signer: Address | string;
  currentRouter: Address | string;
  expectedCurrentRouter: Address | string;
  signerNativeBalance: bigint;
  minimumNativeBalance: bigint;
};

export function validateRouterMigrationPreflight(input: RouterMigrationPreflight): void {
  if (input.actualChainId !== input.expectedChainId) {
    throw new Error(`Router migration chain ID mismatch: expected ${input.expectedChainId}, got ${input.actualChainId}`);
  }
  if (getAddress(input.owner) !== getAddress(input.signer)) {
    throw new Error(`Registry owner does not match migration signer: owner=${input.owner}, signer=${input.signer}`);
  }
  if (getAddress(input.currentRouter) !== getAddress(input.expectedCurrentRouter)) {
    throw new Error(
      `Registry current Router does not match the expected address: current=${input.currentRouter}, expected=${input.expectedCurrentRouter}`,
    );
  }
  if (input.signerNativeBalance < input.minimumNativeBalance) {
    throw new Error(
      `Migration signer native balance is below the safety minimum: balance=${input.signerNativeBalance}, minimum=${input.minimumNativeBalance}`,
    );
  }
}
