// Entry point for the BSC Testnet sponsored execution smoke test.
// The body lives in run-sponsored.impl.ts; this wrapper only exists so a
// configuration mistake prints one readable line instead of a Hardhat stack
// trace. See runScript in ../sponsored-payment-checks.ts.
import { runScript } from "../sponsored-payment-checks.js";

await runScript(() => import("./run-sponsored.impl.js"));
