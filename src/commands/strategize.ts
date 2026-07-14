/**
 * strategize <metric> — one naked gap in, 3–7 registered bets out, one
 * funding card filed. Idempotent by design: refuses while an unresolved bet
 * set exists (no duplicate spending on the same gap).
 */
import { CronfounderError, EXIT } from "../errors.js";
import { computeGapModel } from "../core/gap.js";
import { leverage as scoreLeverage } from "../core/leverage.js";
import { hypothesisReadiness } from "../core/readiness.js";
import { fileRequest, setupChannelSteps } from "../core/inbox.js";
import type { Store } from "../core/store.js";
import type { Out } from "../output.js";
import { compactDate } from "../ids.js";
import { selectAdapter, prepareRun, runtimeMissingError, type RunBundle } from "../runtime/adapter.js";
import { HATS } from "../runtime/hats.js";
import { strategistPrompt } from "../runtime/prompts.js";
import { importStaging } from "../runtime/staging.js";

export interface StrategizeResult {
  registered: string[];
  rejected: Array<{ file: string; reason: string }>;
  funding_card: number | null;
  blocked: string[];
}

export async function strategizeMetric(
  store: Store,
  out: Out,
  metricName: string,
  opts: { runtime?: string; dryRun?: boolean },
): Promise<StrategizeResult | { dry_run: RunBundle }> {
  const db = store.ledger.db;
  const gap = computeGapModel(store);
  const row = gap.rows.find((r) => r.metric === metricName);
  if (!row) {
    throw new CronfounderError({
      code: "E_NOT_FOUND",
      exit: EXIT.VALIDATION,
      problem: `metric "${metricName}" does not exist`,
      cause: "no metrics/<name>.md file is registered under that name",
      fix: `existing metrics: ${gap.rows.map((r) => r.metric).join(", ") || "(none — create one first, see docs/quickstart.md)"}`,
    });
  }
  if (row.classification === "running" || row.classification === "verdict_due") {
    throw new CronfounderError({
      code: "E_METRIC_BUSY",
      exit: EXIT.GATE,
      problem: `metric "${metricName}" has a live bet (${row.bet?.id}) — no new bets while one is measuring`,
      cause: "one active hypothesis per metric: attribution before ambition (invariant VIII)",
      fix: `wait for the verdict (due ${row.bet?.review_at ?? "soon"}), or strategize a different metric`,
      invariant: "VIII",
    });
  }
  if (row.classification === "needs_decision") {
    throw new CronfounderError({
      code: "E_BETS_PENDING",
      exit: EXIT.VALIDATION,
      problem: `metric "${metricName}" already has an unresolved bet set awaiting a funding decision`,
      cause: "strategize is idempotent per gap — regenerating bets would duplicate spend without new information",
      fix: `decide first: cronfounder inbox   (approve, choose, or reject the open set)`,
    });
  }
  if (row.classification === "green") {
    throw new CronfounderError({
      code: "E_NO_GAP",
      exit: EXIT.VALIDATION,
      problem: `metric "${metricName}" is at or above target — there is no gap to close`,
      cause: "strategize exists to close failing tests, and this one passes",
      fix: "raise the spec in the metric file if ambition grew, or strategize a red metric",
    });
  }
  if (row.classification === "unknown") {
    throw new CronfounderError({
      code: "E_NO_TRUTH",
      exit: EXIT.VALIDATION,
      problem: `metric "${metricName}" has no ${row.target === null ? "spec" : "fresh reading"} — a plan computed on fiction is fiction`,
      cause: row.blocker ?? "no spec or no sensor reading",
      fix: row.next_action,
    });
  }

  // Context for the strategist
  const channels = (db.prepare("SELECT id, acceptance, ready FROM channels ORDER BY id").all() as Array<{ id: string; acceptance: string; ready: number }>).map(
    (c) => ({ id: c.id, acceptance: JSON.parse(c.acceptance) as string[], ready: c.ready === 1 }),
  );
  const verdicts = db
    .prepare(
      "SELECT id AS hypothesis, verdict_result AS result, verdict_delta AS delta, metric FROM hypotheses WHERE verdict_result IS NOT NULL ORDER BY decided_at DESC LIMIT 20",
    )
    .all() as Array<{ hypothesis: string; result: string; delta: number; metric: string }>;

  const hat = HATS.strategist;
  const bundle = await prepareRun(store.company, hat, "", ["H-*.md (3-7 hypothesis files)"]);
  const prompt = await strategistPrompt(
    store.company,
    {
      metric: metricName,
      unit: row.unit,
      direction: row.direction,
      gap: row.gap ?? 0,
      value: row.value,
      target: row.target,
      deadline: row.deadline,
      channels,
      journal_verdicts: verdicts,
      id_date: compactDate(),
    },
    bundle.staging_dir,
  );
  const { writeFile } = await import("node:fs/promises");
  await writeFile(bundle.prompt_file, prompt, "utf8");

  if (opts.dryRun) {
    out.progress(`dry run prepared: ${bundle.run_dir}`);
    return { dry_run: bundle };
  }

  const adapter = selectAdapter(store.company, opts.runtime);
  if (!adapter) throw runtimeMissingError("strategize");
  out.progress(`strategist (${adapter.name}) researching the ${metricName} gap…${adapter.name === "stub" ? "" : " (this can take minutes)"}`);
  await adapter.invoke(bundle, prompt, store.company.config.runtime.timeout_s);
  return finishStrategize(store, out, metricName, bundle.staging_dir);
}

/** Import + register + score + gate + funding card. Shared with `run import`. */
export async function finishStrategize(
  store: Store,
  out: Out,
  metricName: string,
  stagingDir: string,
): Promise<StrategizeResult> {
  const db = store.ledger.db;
  const hat = HATS.strategist;
  const report = await importStaging(store, hat, stagingDir);
  for (const r of report.rejected) out.progress(`rejected ${r.file}: ${r.reason}`);
  const registered = report.imported.filter((i) => i.kind === "hypothesis").map((i) => i.id);
  if (registered.length === 0) {
    return { registered: [], rejected: report.rejected, funding_card: null, blocked: [] };
  }

  // score + gates
  const gap = computeGapModel(store);
  const row = gap.rows.find((r) => r.metric === metricName);
  const gapSize = row?.gap ?? 1;
  const blocked: string[] = [];
  const fundable: Array<{ id: string; leverage: number; claim: string; risk: string; cost_tokens: number; cost_human_min: number; confidence: number; confidence_source: string; target_delta: number; unit: string }> = [];
  for (const id of registered) {
    const h = db.prepare("SELECT * FROM hypotheses WHERE id=?").get(id) as any;
    if (h.metric !== metricName) {
      out.progress(`note: ${id} targets ${h.metric}, not ${metricName} — registered but outside this funding card`);
    }
    const ready = hypothesisReadiness(store, JSON.parse(h.channels_json) as string[]);
    const lev = scoreLeverage({
      target_delta: h.target_delta,
      gap: gapSize,
      confidence: h.confidence,
      cost_tokens: h.cost_tokens,
      cost_human_min: h.cost_human_min,
    });
    const toState = ready.ready ? "prioritized" : "blocked";
    await store.commit(
      [
        store.event("core", "state_transition", {
          kind: "hypothesis",
          subject: id,
          from: "proposed",
          to: toState,
          actor: "core",
          leverage: lev,
          ready: ready.ready,
          missing: ready.missing,
        }),
      ],
      [{ kind: "patch", file: h.file_path, patches: { state: toState } }],
      [`core ${toState === "blocked" ? "blocked" : "prioritized"} ${id} (leverage ${lev.toExponential(2)}${ready.missing.length > 0 ? `; missing: ${ready.missing.join("; ")}` : ""})`],
    );
    if (ready.ready && h.metric === metricName) {
      fundable.push({
        id,
        leverage: lev,
        claim: h.claim_summary,
        risk: h.risk,
        cost_tokens: h.cost_tokens,
        cost_human_min: h.cost_human_min,
        confidence: h.confidence,
        confidence_source: h.confidence_source,
        target_delta: h.target_delta,
        unit: h.unit,
      });
    } else if (!ready.ready) {
      blocked.push(id);
      // one setup card per missing prerequisite set
      const channelsMissing = JSON.parse(h.channels_json) as string[];
      for (const ch of channelsMissing) {
        const r = hypothesisReadiness(store, [ch]);
        if (r.ready) continue;
        const chRow = db.prepare("SELECT driver_ref FROM channels WHERE id=?").get(ch) as { driver_ref: string | null } | undefined;
        const existing = db
          .prepare("SELECT 1 FROM inbox WHERE state='open' AND kind='setup_channel' AND blocking_id=?")
          .get(ch);
        if (!existing) {
          await fileRequest(
            store,
            "core",
            "setup_channel",
            {
              what: `set up channel "${ch}" so blocked bets can run`,
              why: `${id} → metric ${metricName}: a brilliant bet on an unbuilt channel queues the setup instead of dying silently`,
              steps: setupChannelSteps(ch, chRow?.driver_ref ?? null),
              blocking: `${id} (and any future bet using ${ch})`,
            },
            { blockingKind: "channel", blockingId: ch },
          );
        }
      }
    }
  }

  fundable.sort((a, b) => b.leverage - a.leverage || (a.id < b.id ? -1 : 1));
  let fundingCard: number | null = null;
  if (fundable.length > 0) {
    fundingCard = await fileRequest(
      store,
      "agent:strategist",
      "approve_hypothesis",
      {
        what: `fund ONE bet to close the ${metricName} gap (${gapSize} ${fundable[0]!.unit} short)`,
        why: `${metricName} is a failing test; these are the strategist's priced, falsifiable options — most bets fail, and each failure is paid-for knowledge`,
        steps: [],
        blocking: `all work on ${metricName} until a bet is funded (approval is ignition)`,
        choices: fundable.map((f, i) => ({
          key: f.id,
          label: `${i === 0 ? "[recommended] " : ""}${f.claim}`,
          detail: `Δ+${f.target_delta} ${f.unit} claimed · ${f.cost_tokens} tokens + ${f.cost_human_min} human-min · risk ${f.risk} · confidence ${f.confidence} (${f.confidence_source}) · leverage ${f.leverage.toExponential(2)}`,
        })),
        hypothesis: fundable[0]!.id,
        metric: metricName,
      },
      { blockingKind: "metric", blockingId: metricName },
    );
  }
  return { registered, rejected: report.rejected, funding_card: fundingCard, blocked };
}

export async function strategizeCommand(
  store: Store,
  out: Out,
  metricName: string,
  opts: { runtime?: string; dryRun?: boolean },
): Promise<void> {
  const result = await strategizeMetric(store, out, metricName, opts);
  if ("dry_run" in result) {
    out.ok("strategize:dry-run", result.dry_run, () => {
      out.print(`dry run prepared — do the strategist's thinking yourself:`);
      out.print(`  1. read the prompt:            ${result.dry_run.prompt_file}`);
      out.print(`  2. write hypothesis files to:  ${result.dry_run.staging_dir}`);
      out.print(`  3. import them:                cronfounder run import ${result.dry_run.run_id}`);
    });
  }
  const r = result as StrategizeResult;
  out.ok("strategize", r, () => {
    out.print(`registered ${r.registered.length} bet(s): ${r.registered.join(", ") || "none"}`);
    if (r.blocked.length > 0) out.print(`blocked on setup: ${r.blocked.join(", ")} (setup cards filed)`);
    if (r.rejected.length > 0) {
      out.print(`rejected ${r.rejected.length} (schema said no — invariant VII has no exceptions):`);
      for (const rej of r.rejected) out.print(`  ${rej.file}: ${rej.reason}`);
    }
    if (r.funding_card !== null) out.print(`\nfunding decision waiting: cronfounder inbox   (card R-${r.funding_card})`);
  });
}
