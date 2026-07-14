/**
 * plan — the diff. The core computes the entire gap model deterministically;
 * the planner hat (if a runtime exists) adds one page of narration. Triggers
 * green-lane checks; the gap report is printed AND journaled.
 */
import { computeGapModel, type GapModel } from "../core/gap.js";
import type { Store } from "../core/store.js";
import type { Out } from "../output.js";
import { renderGapTerminal } from "../render/terminal.js";
import { selectAdapter, prepareRun } from "../runtime/adapter.js";
import { HATS } from "../runtime/hats.js";
import { plannerPrompt } from "../runtime/prompts.js";
import { importStaging } from "../runtime/staging.js";
import { greenLaneCheck } from "./greenlane.js";

export async function runPlan(
  store: Store,
  out: Out,
  opts: { runtime?: string; dryRun?: boolean },
): Promise<{ gap: GapModel; narration: string | null; activated: string[] }> {
  const gap = computeGapModel(store);
  await store.append([
    store.event("planner", "journal_note", {
      action: "gap_report",
      refs: gap.rows.map((r) => `metric:${r.metric}`),
      text: gap.rows
        .map((r) => `${r.metric}: ${r.classification}${r.gap !== null ? ` (gap ${r.gap})` : ""}${r.blocker ? ` — ${r.blocker}` : ""}`)
        .join(" · "),
    }),
  ]);

  // green lane: prioritized bets may auto-activate inside the budget
  const activated = await greenLaneCheck(store, out);

  let narration: string | null = null;
  const adapter = selectAdapter(store.company, opts.runtime);
  if (adapter && !opts.dryRun) {
    try {
      const hat = HATS.planner;
      const staging = await prepareRun(store.company, hat, "", []);
      const prompt = await plannerPrompt(store.company, JSON.stringify(gap), staging.staging_dir);
      out.progress(`planner (${adapter.name}) narrating the diff…`);
      await adapter.invoke({ ...staging, allowed_tools: hat.allowedTools }, prompt, store.company.config.runtime.timeout_s);
      const report = await importStaging(store, hat, staging.staging_dir);
      narration = report.narration;
    } catch (e) {
      out.progress(`planner narration skipped: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
  }
  return { gap, narration, activated };
}

export async function planCommand(store: Store, out: Out, opts: { runtime?: string }): Promise<void> {
  const { gap, narration, activated } = await runPlan(store, out, opts);
  out.ok("plan", { gap, narration, green_lane_activated: activated }, () => {
    out.print(renderGapTerminal(gap));
    if (activated.length > 0) out.print(`green lane activated: ${activated.join(", ")} (within constitution budget; journaled)`);
    if (narration) out.print(`\n— planner narration —\n${narration}`);
  });
}
