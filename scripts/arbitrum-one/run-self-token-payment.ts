// Entry point for the Arbitrum One self-payment run (executeFromSelf, no
// sponsor and no router). The body lives in run-self-token-payment.impl.ts;
// this wrapper only exists so a configuration mistake prints one readable
// line instead of a Hardhat stack trace.
import { runScript } from "../sponsored-payment-checks.js";

await runScript(() => import("./run-self-token-payment.impl.js"));
