/**
 * The runtime seam (spec Decision 1) — a typed adapter, not a command string.
 * Runtime selection lives in human-owned config (never model-writable), with
 * --runtime / CRONFOUNDER_RUNTIME as one-off overrides.
 *
 * Every invocation: argv array (shell:false), stdin closed, minimal env
 * passlist (runtime auth only — channel credentials are NEVER in a hat's
 * environment), hard timeout, outputs written to a per-run staging dir that
 * the deterministic core validates and imports.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CronfounderError, EXIT } from "../errors.js";
import type { Company } from "../core/company.js";
import { runId } from "../ids.js";
import type { Hat } from "./hats.js";
import { ClaudeAdapter } from "./claude.js";
import { StubAdapter } from "./stub.js";

export interface RunBundle {
  run_id: string;
  hat: Hat["name"];
  run_dir: string;
  staging_dir: string;
  prompt_file: string;
  allowed_tools: string[];
  expected_artifacts: string[];
}

export interface RuntimeResult {
  ok: boolean;
  detail: string;
}

export interface RuntimeAdapter {
  readonly name: string;
  invoke(bundle: RunBundle, promptText: string, timeoutS: number): Promise<RuntimeResult>;
}

export function selectAdapter(company: Company, override?: string): RuntimeAdapter | null {
  const choice = override ?? process.env.CRONFOUNDER_RUNTIME ?? company.config.runtime.adapter;
  switch (choice) {
    case "claude":
      return new ClaudeAdapter(company.config.runtime.command ?? "claude");
    case "stub":
      return new StubAdapter();
    case "none":
      return null;
    default:
      throw new CronfounderError({
        code: "E_RUNTIME_UNKNOWN",
        exit: EXIT.VALIDATION,
        problem: `unknown runtime adapter "${choice}"`,
        cause: "runtime.adapter must be one of: claude, stub, none",
        fix: "edit .cronfounder/config.json (or pass --runtime claude|stub)",
      });
  }
}

export function runtimeMissingError(commandName: string): CronfounderError {
  return new CronfounderError({
    code: "E_RUNTIME_NONE",
    exit: EXIT.ERROR,
    problem: `"${commandName}" needs a runtime to think, and none is configured`,
    cause: 'runtime.adapter is "none" in .cronfounder/config.json',
    fix: [
      "three ways forward:",
      '  1. install Claude Code and set runtime.adapter to "claude" (docs/installation.md#runtime)',
      `  2. run with --dry-run: cronfounder writes the exact prompt + expected outputs, you (or your operating agent) do the thinking, then: cronfounder run import <run-id>`,
      '  3. try the harness keyless first: cronfounder init demo-co --demo',
    ].join("\n"),
  });
}

/** Prepare the run + staging dirs and the run.json manifest (also the --dry-run bundle). */
export async function prepareRun(
  company: Company,
  hat: Hat,
  promptText: string,
  expectedArtifacts: string[],
): Promise<RunBundle> {
  const id = runId();
  const runDir = path.join(company.paths.runs, id);
  const stagingDir = path.join(company.paths.staging, id);
  await mkdir(runDir, { recursive: true });
  await mkdir(stagingDir, { recursive: true });
  const promptFile = path.join(runDir, "prompt.md");
  await writeFile(promptFile, promptText, "utf8");
  const bundle: RunBundle = {
    run_id: id,
    hat: hat.name,
    run_dir: runDir,
    staging_dir: stagingDir,
    prompt_file: promptFile,
    allowed_tools: hat.allowedTools,
    expected_artifacts: expectedArtifacts,
  };
  await writeFile(path.join(runDir, "run.json"), JSON.stringify(bundle, null, 2) + "\n", "utf8");
  return bundle;
}
