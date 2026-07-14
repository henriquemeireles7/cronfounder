/**
 * Activation — approval is ignition. The moment a bet is funded (human gate
 * or green lane) it compiles into typed projects + tasks and is ready to
 * build. Preconditions enforced here, once, for both callers:
 *   - WIP limit (invariant VIII) at constraint level
 *   - fresh baseline reading exists (verdicts need a real starting point)
 *   - readiness (blocked bets cannot be activated)
 * review_at = activated_at + duration_days (computed at activation, never at
 * registration — a bet that sat proposed for two weeks doesn't lose its window).
 */
import { CronfounderError, EXIT, gateRefusal } from "../errors.js";
import { iso, now } from "../ids.js";
import { assertHypothesisTransition } from "./states.js";
import { Ledger } from "./ledger.js";
import type { Store } from "./store.js";
import type { CfEvent } from "./events.js";

export interface ActivationResult {
  hypothesis: string;
  review_at: string;
  projects: Array<{ id: number; type: string; channel: string; builder: string }>;
  tasks: number[];
}

export async function activateHypothesis(
  store: Store,
  hypothesisId: string,
  actor: "human" | "green_lane",
  actorName: string,
): Promise<ActivationResult> {
  const db = store.ledger.db;
  const h = db.prepare("SELECT * FROM hypotheses WHERE id=?").get(hypothesisId) as any;
  if (!h) {
    throw new CronfounderError({
      code: "E_NOT_FOUND",
      exit: EXIT.VALIDATION,
      problem: `hypothesis ${hypothesisId} does not exist`,
      cause: "the id is wrong or the file was never registered",
      fix: "list bets: cronfounder board --json",
    });
  }
  if (h.disposition !== "open") {
    throw new CronfounderError({
      code: "E_DISPOSED",
      exit: EXIT.VALIDATION,
      problem: `hypothesis ${hypothesisId} is ${h.disposition}`,
      cause: "rejected or closed bets cannot be activated",
      fix: "pick an open bet from: cronfounder board",
    });
  }
  assertHypothesisTransition(hypothesisId, h.state, "active", actor);
  if (h.ready !== 1) {
    const missing = h.missing_json ? (JSON.parse(h.missing_json) as string[]) : ["readiness unknown"];
    throw gateRefusal({
      code: "E_NOT_READY",
      invariant: "IV",
      invariantText: "missing infrastructure is visible, queued work — not silent death",
      problem: `${hypothesisId} is not ready: ${missing.join("; ")}`,
      fix: "resolve its setup_channel/provide_credential cards first: cronfounder inbox",
    });
  }
  if (h.risk === "irreversible" && actor === "green_lane") {
    throw gateRefusal({
      code: "E_RISK_GATE",
      invariant: "X",
      invariantText: "risk gates cannot be bought",
      problem: `${hypothesisId} is irreversible and can never enter the green lane`,
      fix: "a human must fund it: cronfounder resolve <R-id> --approve",
    });
  }

  // Baseline: the most recent reading, and it must be fresh.
  const baseline = db
    .prepare("SELECT id, value, measured_at FROM metric_history WHERE metric=? ORDER BY measured_at DESC, id DESC LIMIT 1")
    .get(h.metric) as { id: number; value: number; measured_at: string } | undefined;
  if (!baseline) {
    throw new CronfounderError({
      code: "E_NO_BASELINE",
      exit: EXIT.GATE,
      problem: `metric "${h.metric}" has no sensor history — a verdict would have no starting point (invariant IX)`,
      cause: "sense has never successfully measured this metric",
      fix: "run: cronfounder sense   then retry the approval",
      invariant: "IX",
    });
  }
  const ageHours = (now().getTime() - new Date(baseline.measured_at).getTime()) / 3600_000;
  if (ageHours > store.company.config.freshness_hours) {
    throw new CronfounderError({
      code: "E_BASELINE_STALE",
      exit: EXIT.GATE,
      problem: `baseline for "${h.metric}" is ${Math.round(ageHours)}h old (freshness window: ${store.company.config.freshness_hours}h)`,
      cause: "activating on a stale baseline would poison the verdict",
      fix: "run: cronfounder sense   then retry the approval",
      invariant: "IX",
      retryable: true,
    });
  }

  const activatedAt = iso();
  const reviewAt = iso(new Date(now().getTime() + h.duration_days * 86400_000));
  const projectSpecs = JSON.parse(h.projects_json) as Array<{
    type: "content" | "channel_setup";
    channel: string;
    payload_type: string;
    count: number;
    brief: string;
  }>;
  const projects: ActivationResult["projects"] = [];
  const taskIds: number[] = [];
  const events: CfEvent[] = [];
  let nextProject = store.nextId("projects");
  let nextTask = store.nextId("tasks");
  const compiled = {
    hypothesis: hypothesisId,
    projects: [] as Array<Record<string, unknown>>,
    tasks: [] as Array<Record<string, unknown>>,
  };
  for (const spec of projectSpecs) {
    const builder = spec.type === "content" ? "content_builder" : "channel_builder";
    compiled.projects.push({
      id: nextProject,
      type: spec.type,
      channel: spec.channel,
      payload_type: spec.payload_type,
      builder,
      brief: spec.brief,
    });
    compiled.tasks.push({ id: nextTask, project: nextProject, kind: "produce", brief: `${spec.brief} (count: ${spec.count})` });
    projects.push({ id: nextProject, type: spec.type, channel: spec.channel, builder });
    taskIds.push(nextTask);
    nextProject++;
    nextTask++;
  }

  events.push(
    store.event(actorName, "state_transition", {
      kind: "hypothesis",
      subject: hypothesisId,
      from: h.state,
      to: "active",
      actor,
      activated_at: activatedAt,
      review_at: reviewAt,
      baseline_value: baseline.value,
      baseline_reading: baseline.id,
      snapshot: {
        green_lane: actor === "green_lane",
        risk: h.risk,
        cost_tokens: h.cost_tokens,
        playbook: h.playbook,
      },
    }),
    store.event(actorName, "compiled", compiled),
  );

  try {
    await store.commit(events, [
      {
        kind: "patch",
        file: h.file_path,
        patches: {
          state: "active",
          activated_at: activatedAt,
          review_at: reviewAt,
          baseline: { value: baseline.value, measured_at: baseline.measured_at, reading_id: baseline.id },
        },
      },
    ], [
      `${actorName} activated ${hypothesisId} on ${h.metric} (review at ${reviewAt}; baseline ${baseline.value}) — approval is ignition: ${projects.length} project(s), ${taskIds.length} task(s) compiled`,
    ]);
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message) && /hypotheses/i.test(e.message)) {
      const holder = db
        .prepare("SELECT id FROM hypotheses WHERE metric=? AND state IN ('active','measuring','paused')")
        .get(h.metric) as { id: string } | undefined;
      throw Ledger.wipRefusal(h.metric, holder?.id ?? "another bet");
    }
    throw e;
  }
  return { hypothesis: hypothesisId, review_at: reviewAt, projects, tasks: taskIds };
}

/** Pre-check the WIP slot so callers get the invariant refusal, not a SQL error. */
export function assertWipFree(store: Store, metric: string): void {
  const holder = store.ledger.db
    .prepare("SELECT id FROM hypotheses WHERE metric=? AND state IN ('active','measuring','paused') AND disposition='open'")
    .get(metric) as { id: string } | undefined;
  if (holder) {
    throw Ledger.wipRefusal(metric, holder.id);
  }
}
