/**
 * run import <run-id> · run list — the dry-run loop's second half, and the
 * agent-native interface: an operating agent wears the hat itself (writes
 * artifacts into the staging dir) and imports them through the IDENTICAL
 * validate-and-import pipeline a live runtime run uses.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { CronfounderError, EXIT } from "../errors.js";
import type { Store } from "../core/store.js";
import type { Out } from "../output.js";
import { finishStrategize } from "./strategize.js";
import { finishBuildTask } from "./build.js";
import { HATS } from "../runtime/hats.js";
import { importStaging } from "../runtime/staging.js";

export async function runListCommand(store: Store, out: Out): Promise<void> {
  const runsDir = store.company.paths.runs;
  const runs: Array<{ run_id: string; hat: string; command?: string; imported?: boolean }> = [];
  if (existsSync(runsDir)) {
    for (const id of (await readdir(runsDir)).sort()) {
      const runJson = path.join(runsDir, id, "run.json");
      if (!existsSync(runJson)) continue;
      try {
        const bundle = JSON.parse(await readFile(runJson, "utf8"));
        const ctxFile = path.join(runsDir, id, "context.json");
        const ctx = existsSync(ctxFile) ? JSON.parse(await readFile(ctxFile, "utf8")) : {};
        runs.push({ run_id: id, hat: bundle.hat, command: ctx.command, imported: !existsSync(bundle.staging_dir) });
      } catch {
        /* skip unreadable */
      }
    }
  }
  out.ok("run:list", { runs }, () => {
    if (runs.length === 0) {
      out.print("no runs yet — create one with any --dry-run command");
      return;
    }
    for (const r of runs) out.print(`${r.run_id}  hat:${r.hat}${r.command ? `  from:${r.command}` : ""}${r.imported ? "  (staging gone — likely imported)" : ""}`);
  });
}

export async function runImportCommand(store: Store, out: Out, runIdArg: string): Promise<void> {
  const runDir = path.join(store.company.paths.runs, runIdArg);
  const runJson = path.join(runDir, "run.json");
  if (!existsSync(runJson)) {
    throw new CronfounderError({
      code: "E_NOT_FOUND",
      exit: EXIT.VALIDATION,
      problem: `run "${runIdArg}" not found`,
      cause: `no ${runJson}`,
      fix: "list runs: cronfounder run list",
    });
  }
  const bundle = JSON.parse(await readFile(runJson, "utf8")) as { hat: keyof typeof HATS; staging_dir: string };
  if (!existsSync(bundle.staging_dir)) {
    throw new CronfounderError({
      code: "E_ALREADY_IMPORTED",
      exit: EXIT.VALIDATION,
      problem: `run "${runIdArg}" has no staging dir — it was already imported (staging is cleaned on success)`,
      cause: "imports are exactly-once",
      fix: "start a fresh --dry-run if you need another pass",
    });
  }
  const ctxFile = path.join(runDir, "context.json");
  const ctx = existsSync(ctxFile) ? (JSON.parse(await readFile(ctxFile, "utf8")) as Record<string, any>) : {};

  if (ctx.command === "build" && typeof ctx.task === "number") {
    const res = await finishBuildTask(store, out, ctx.task, bundle.staging_dir);
    await cleanupStaging(bundle.staging_dir);
    out.ok("run:import", res, () => {
      out.print(`imported ${res.drafted.length} draft(s): ${res.drafted.join(", ") || "none"}`);
      if (res.cards.length > 0) out.print(`approval cards filed — release: cronfounder inbox`);
    });
  }
  if (bundle.hat === "strategist") {
    // metric comes from the prompt context; require it in run.json context or infer from staged files
    const metric = ctx.metric ?? (await inferMetric(bundle.staging_dir));
    const res = await finishStrategize(store, out, String(metric), bundle.staging_dir);
    await cleanupStaging(bundle.staging_dir);
    out.ok("run:import", res, () => {
      out.print(`registered ${res.registered.length} bet(s); ${res.rejected.length} rejected`);
      for (const rej of res.rejected) out.print(`  ${rej.file}: ${rej.reason}`);
      if (res.funding_card !== null) out.print(`funding decision: cronfounder resolve R-${res.funding_card} --approve`);
    });
  }
  // generic: narration / doctrine drafts
  const report = await importStaging(store, HATS[bundle.hat], bundle.staging_dir);
  await cleanupStaging(bundle.staging_dir);
  out.ok("run:import", report, () => {
    if (report.narration) out.print(report.narration);
    for (const i of report.imported) out.print(`imported ${i.kind}: ${i.id}`);
    for (const r of report.rejected) out.print(`rejected ${r.file}: ${r.reason}`);
  });
}

async function inferMetric(stagingDir: string): Promise<string> {
  const { readFm } = await import("../core/fm.js");
  for (const f of (await readdir(stagingDir)).sort()) {
    if (f.endsWith(".md") && f.startsWith("H-")) {
      try {
        const fm = await readFm(path.join(stagingDir, f));
        if (typeof fm.data.metric === "string") return fm.data.metric;
      } catch {
        /* keep looking */
      }
    }
  }
  throw new CronfounderError({
    code: "E_NO_METRIC",
    exit: EXIT.VALIDATION,
    problem: "cannot infer which metric this strategist run targets",
    cause: "no valid H-*.md in staging names a metric",
    fix: "write at least one schema-valid hypothesis file into the staging dir first",
  });
}

async function cleanupStaging(stagingDir: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
}
