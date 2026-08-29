// Cross-chain canary for the self-relayer path.
//
// Runs one real sponsored payment per (chain, fee token) pair by invoking the
// same single-chain scripts an operator would run by hand, with the token and
// amount pinned per target through the child process env. Nothing about the
// send path is reimplemented here, so a target that passes the canary passes
// the exact code that runs in production.
//
//   npm run canary:self-relayer -- --dry-run
//   npm run canary:self-relayer -- --only=bsc-testnet-usdt,bsc-testnet-usdc
//   npm run canary:self-relayer
//
// Targets whose chain has not whitelisted our sponsor yet fail with the
// registry's own message; that is reported per target rather than aborting
// the sweep.
import "dotenv/config";

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

import {
  CANARY_TARGETS,
  childEnvFor,
  classifyResult,
  extractFailure,
  extractTxHash,
  isTargetBlocked,
  parseArgs,
  selectTargets,
  type CanaryStatus,
  type CanaryTarget,
} from "./self-relayer-canary-plan.ts";

// Dry runs write to their own files. Sharing one path let a later preview
// overwrite the record of a live sweep, and a live report is the only place
// the transaction hashes are collected.
const REPORT_BASE = "evm-7702-sponsored/reports/self-relayer-canary";

type CanaryResult = {
  chainKey: string;
  network: string;
  tokenSymbol: string;
  tokenAddress: string | null;
  amount: string | null;
  status: CanaryStatus | "skipped";
  txHash: string | null;
  failure: string | null;
};

function resolveEnv(prefix: string, key: string) {
  return process.env[`${prefix}_${key}`]?.trim() || process.env[key]?.trim() || undefined;
}

function runTarget(target: CanaryTarget, env: Record<string, string>) {
  // stdout and stderr are kept apart: the transaction hash is printed to
  // stdout, the failure reason to stderr. Merging them would make either one
  // hard to pick out of the other's noise.
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(
      "npx",
      ["hardhat", "--network", target.network, "run", target.script, "--no-compile"],
      { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const { dryRun, allowMainnet, only } = parseArgs(process.argv.slice(2));
const targets = selectTargets(CANARY_TARGETS, only);

console.log(`Self-relayer canary — ${targets.length} target(s), mode ${dryRun ? "DRY RUN" : "LIVE"}`);
for (const target of targets) {
  const gate = isTargetBlocked(target, dryRun, allowMainnet) ? "  [BLOCKED: mainnet]" : "";
  console.log(`  ${target.chainKey.padEnd(20)} ${target.network} / ${target.tokenSymbol}${gate}`);
}
if (!dryRun) {
  console.log("\nLIVE: each passing target sends one real transaction and spends real funds.");
  if (allowMainnet) {
    console.log("--allow-mainnet given: mainnet targets WILL spend real money.");
  }
}

const results: CanaryResult[] = [];

for (const target of targets) {
  console.log(`\n${"=".repeat(70)}\n${target.chainKey}\n${"=".repeat(70)}`);

  if (isTargetBlocked(target, dryRun, allowMainnet)) {
    const failure = "Mainnet target blocked; pass --allow-mainnet to spend real funds";
    console.log(`BLOCKED: ${failure}`);
    results.push({
      chainKey: target.chainKey,
      network: target.network,
      tokenSymbol: target.tokenSymbol,
      tokenAddress: null,
      amount: null,
      status: "skipped",
      txHash: null,
      failure,
    });
    continue;
  }

  const tokenAddress = resolveEnv(target.envPrefix, target.tokenEnvKey);
  if (tokenAddress === undefined) {
    // Not a failure of the send path — this chain simply has no such token
    // configured, so record it as skipped rather than as a broken target.
    const failure = `Missing ${target.envPrefix}_${target.tokenEnvKey}`;
    console.log(`SKIPPED: ${failure}`);
    results.push({
      chainKey: target.chainKey,
      network: target.network,
      tokenSymbol: target.tokenSymbol,
      tokenAddress: null,
      amount: null,
      status: "skipped",
      txHash: null,
      failure,
    });
    continue;
  }

  const amount = resolveEnv(target.envPrefix, "CANARY_AMOUNT") ?? target.defaultAmount;
  const { code, stdout, stderr } = await runTarget(target, childEnvFor(target, tokenAddress, amount, dryRun));
  const txHash = extractTxHash(stdout);
  const status = classifyResult(code, txHash);
  if (status === "unconfirmed") {
    console.log("\nSENT BUT UNCONFIRMED: the transaction is on chain or on its way.");
    console.log("Check it before re-running — a re-run spends again.");
  }

  results.push({
    chainKey: target.chainKey,
    network: target.network,
    tokenSymbol: target.tokenSymbol,
    tokenAddress,
    amount,
    status,
    txHash: txHash ?? null,
    failure: status === "passed" ? null : (extractFailure(stderr) ?? `exit code ${code}`),
  });
}

const passed = results.filter((r) => r.status === "passed");
const unconfirmed = results.filter((r) => r.status === "unconfirmed");
const skipped = results.filter((r) => r.status === "skipped");
const failed = results.filter((r) => r.status === "failed");

console.log(`\n${"=".repeat(70)}\nSummary — ${passed.length} passed, ${unconfirmed.length} unconfirmed, ${failed.length} failed, ${skipped.length} skipped`);
for (const r of results) {
  const label = { passed: "PASS", unconfirmed: "SENT?", failed: "FAIL", skipped: "SKIP" }[r.status];
  const detail = r.txHash ?? r.failure ?? (dryRun ? "dry run" : "");
  console.log(`  ${label}  ${r.chainKey.padEnd(20)} ${r.tokenSymbol.padEnd(6)} ${detail}`);
}

const markdown = [
  "# Self-relayer canary",
  "",
  `Mode: ${dryRun ? "dry run (no transactions sent)" : "live"}`,
  `Result: ${passed.length} passed, ${unconfirmed.length} unconfirmed, ${failed.length} failed, ${skipped.length} skipped`,
  ...(unconfirmed.length > 0
    ? ["", "Unconfirmed targets sent a transaction but lost the RPC before the receipt.", "Verify each on chain before re-running: a re-run spends again."]
    : []),
  "",
  "| Target | Network | Token | Status | Transaction / reason |",
  "| --- | --- | --- | --- | --- |",
  ...results.map(
    (r) => `| ${r.chainKey} | ${r.network} | ${r.tokenSymbol} | ${r.status} | ${r.txHash ?? r.failure ?? "-"} |`,
  ),
  "",
].join("\n");

const reportMdPath = `${REPORT_BASE}${dryRun ? "-dry-run" : ""}.md`;
const reportJsonPath = `${REPORT_BASE}${dryRun ? "-dry-run" : ""}.json`;

await mkdir("evm-7702-sponsored/reports", { recursive: true });
await Promise.all([
  writeFile(reportMdPath, markdown, "utf8"),
  writeFile(reportJsonPath, `${JSON.stringify({ dryRun, results }, null, 2)}\n`, "utf8"),
]);
console.log(`\nWrote ${reportMdPath} and ${reportJsonPath}`);

// A skipped target is a configuration gap, not a regression, so it does not
// fail the sweep on its own.
// Unconfirmed still needs a human to check, so it is not a clean exit.
if (failed.length > 0 || unconfirmed.length > 0) {
  process.exitCode = 1;
}
