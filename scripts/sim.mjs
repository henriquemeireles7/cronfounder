#!/usr/bin/env node
/**
 * sim — a company with HISTORY, not a blank scaffold: a funded bet, released
 * and published content, sensor readings across two weeks, and a computed
 * verdict. Realistic data for agents (and humans) to work against.
 *
 *   npm run sim            → ./sim-co
 *   node scripts/sim.mjs <dir>
 *
 * Deterministic: drives the keyless demo machinery through time with
 * CRONFOUNDER_NOW. Re-running recreates the directory from scratch.
 */
import { spawnSync } from "node:child_process";
import { rmSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? "sim-co");
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const t0 = Date.parse(process.env.SIM_T0 ?? "2026-06-01T12:00:00Z");
const at = (days) => new Date(t0 + days * 86400_000).toISOString().replace(/\.\d{3}Z$/, "Z");

function run(days, args) {
  const r = spawnSync(process.execPath, [cli, ...args, "--company", dir, "--quiet"], {
    encoding: "utf8",
    env: { ...process.env, CRONFOUNDER_NOW: at(days) },
  });
  if (r.status !== 0) {
    process.stderr.write(`sim: ${args.join(" ")} @ day ${days} exited ${r.status}\n${r.stderr}${r.stdout}`);
    process.exit(r.status ?? 1);
  }
  return r.stdout;
}

rmSync(dir, { recursive: true, force: true });
const init = spawnSync(process.execPath, [cli, "init", dir, "--demo", "--yes", "--quiet"], {
  encoding: "utf8",
  env: { ...process.env, CRONFOUNDER_NOW: at(0) },
});
if (init.status !== 0) {
  process.stderr.write(init.stderr + init.stdout);
  process.exit(init.status ?? 1);
}

run(0, ["resolve", "R-1", "--approve"]); // fund the recommended bet
run(1, ["build"]); //                       drafts stop at the gate
run(1, ["resolve", "R-2", "--approve"]); // release one draft
run(1, ["push"]); //                        publish → watch window opens

// move the simulated metric so the verdict has real movement to judge
const mockFile = path.join(dir, ".cronfounder", "mock", "mock.json");
const mock = JSON.parse(readFileSync(mockFile, "utf8"));
mock.value = 31;
writeFileSync(mockFile, JSON.stringify(mock, null, 2) + "\n");

run(4, ["watch"]); //   reflex tick while the window is open
run(7, ["sense"]); //   mid-flight reading
run(14, ["sense"]); //  reading at review time
run(15, ["watch"]); //  window is past — closes clean
run(15, ["verdict"]); // review_at has passed — the season clock judges
run(15, ["sense"]);
run(15, ["plan"]); //   fresh gap report over the history

process.stdout.write(
  [
    `sim company ready: ${dir}`,
    `  15 days of history: a funded bet, a published post, 4 readings, a computed verdict`,
    `  look around:  node ${path.relative(process.cwd(), cli)} board --company ${dir}`,
    `                node ${path.relative(process.cwd(), cli)} inbox --json --company ${dir}`,
    ``,
  ].join("\n"),
);
