import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

export interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
  json?: any;
}

export function cf(cwd: string, args: string[], opts: { now?: string; env?: Record<string, string> } = {}): CliResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      PATH: process.env.PATH!,
      HOME: process.env.HOME!,
      NO_COLOR: "1",
      ...(opts.now ? { CRONFOUNDER_NOW: opts.now } : {}),
      ...(opts.env ?? {}),
    },
  });
  let json: any;
  if (args.includes("--json")) {
    try {
      json = JSON.parse(res.stdout);
    } catch {
      /* leave undefined; test will assert */
    }
  }
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr, json };
}

export function tmpCompany(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "cf-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const T0 = "2026-07-13T12:00:00Z";

/** Scaffold a demo company and run through the funding card. */
export function demoCompany(root: string, now = T0): string {
  const r = cf(root, ["init", "demo", "--demo", "--yes", "--quiet"], { now });
  if (r.status !== 0) throw new Error(`init --demo failed: ${r.stderr}\n${r.stdout}`);
  return path.join(root, "demo");
}
