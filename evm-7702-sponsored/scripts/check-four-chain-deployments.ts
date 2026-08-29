import { runFiveChainDeploymentPreflightCli } from "./four-chain-deployment-preflight.js";

console.warn("preflight:four-chain is deprecated; running the five-chain manifest instead");
await runFiveChainDeploymentPreflightCli();
