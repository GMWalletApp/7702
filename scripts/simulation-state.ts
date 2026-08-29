export type SimulationState = {
  nonce: bigint;
  userBalance: bigint;
  merchantBalance: bigint;
  feeReceiverBalance: bigint;
};

export function assertSimulationStateUnchanged(before: SimulationState, after: SimulationState) {
  if (after.nonce !== before.nonce) {
    throw new Error(`nonce changed during simulation: ${before.nonce} -> ${after.nonce}`);
  }
  if (after.userBalance !== before.userBalance) {
    throw new Error(`user balance changed during simulation: ${before.userBalance} -> ${after.userBalance}`);
  }
  if (after.merchantBalance !== before.merchantBalance) {
    throw new Error(`merchant balance changed during simulation: ${before.merchantBalance} -> ${after.merchantBalance}`);
  }
  if (after.feeReceiverBalance !== before.feeReceiverBalance) {
    throw new Error(
      `fee receiver balance changed during simulation: ${before.feeReceiverBalance} -> ${after.feeReceiverBalance}`,
    );
  }
}
