/**
 * The gap model — computed by the deterministic core; the planner hat only
 * narrates. Classification, direction-adjusted gaps, trajectory, freshness
 * and next actions are code, never model arithmetic.
 */
import type { Store } from "./store.js";
import { iso, now } from "../ids.js";

export type GapClass = "naked" | "needs_decision" | "running" | "verdict_due" | "blocked" | "green" | "unknown";

export interface GapRow {
  metric: string;
  unit: string;
  direction: "increase" | "decrease";
  value: number | null;
  measured_at: string | null;
  freshness: "fresh" | "stale" | "unknown" | "error";
  target: number | null;
  deadline: string | null;
  gap: number | null; // direction-adjusted: >0 means short of target
  gap_pct: number | null;
  trajectory_per_day: number | null;
  needed_per_day: number | null;
  bet: { id: string; state: string; review_at: string | null; day: number | null; total_days: number | null; delta_so_far: number | null; claimed_delta: number | null } | null;
  classification: GapClass;
  blocker: string | null;
  next_action: string;
}

export interface GapModel {
  v: 1;
  generated_at: string;
  rows: GapRow[];
}

export function computeGapModel(store: Store): GapModel {
  const db = store.ledger.db;
  const freshnessMs = store.company.config.freshness_hours * 3600_000;
  const nowMs = now().getTime();

  const metrics = db
    .prepare("SELECT name, unit, direction, target, deadline, status_value, status_measured_at FROM metrics ORDER BY name")
    .all() as Array<{
    name: string;
    unit: string;
    direction: "increase" | "decrease";
    target: number | null;
    deadline: string | null;
    status_value: number | null;
    status_measured_at: string | null;
  }>;

  const rows: GapRow[] = [];
  for (const m of metrics) {
    const failure = db.prepare("SELECT consecutive FROM sensor_failures WHERE metric=?").get(m.name) as
      | { consecutive: number }
      | undefined;
    let freshness: GapRow["freshness"];
    if (failure && failure.consecutive >= 3) freshness = "error";
    else if (m.status_measured_at === null) freshness = "unknown";
    else if (nowMs - new Date(m.status_measured_at).getTime() > freshnessMs) freshness = "stale";
    else freshness = "fresh";

    const sign = m.direction === "increase" ? 1 : -1;
    const gap =
      m.target !== null && m.status_value !== null ? sign * (m.target - m.status_value) : null;
    const gapPct = gap !== null && m.target !== null && m.target !== 0 ? Math.round((gap / Math.abs(m.target)) * 1000) / 10 : null;

    // trajectory: least-squares slope over the last 14 days of history
    const hist = db
      .prepare("SELECT value, measured_at FROM metric_history WHERE metric=? ORDER BY measured_at DESC LIMIT 14")
      .all() as Array<{ value: number; measured_at: string }>;
    let trajectory: number | null = null;
    if (hist.length >= 2) {
      const pts = hist.map((h) => ({ x: new Date(h.measured_at).getTime() / 86400_000, y: h.value }));
      const n = pts.length;
      const sx = pts.reduce((a, p) => a + p.x, 0);
      const sy = pts.reduce((a, p) => a + p.y, 0);
      const sxx = pts.reduce((a, p) => a + p.x * p.x, 0);
      const sxy = pts.reduce((a, p) => a + p.x * p.y, 0);
      const denom = n * sxx - sx * sx;
      trajectory = denom === 0 ? null : Math.round(((n * sxy - sx * sy) / denom) * 100) / 100;
    }
    let neededPerDay: number | null = null;
    if (gap !== null && gap > 0 && m.deadline) {
      const days = Math.max(1, (new Date(m.deadline).getTime() - nowMs) / 86400_000);
      neededPerDay = Math.round((gap / days) * 100) / 100;
    }

    // bet state on this metric
    const active = db
      .prepare(
        "SELECT id, state, review_at, activated_at, baseline_value, target_delta FROM hypotheses WHERE metric=? AND state IN ('active','measuring','paused') AND disposition='open'",
      )
      .get(m.name) as
      | { id: string; state: string; review_at: string | null; activated_at: string | null; baseline_value: number | null; target_delta: number }
      | undefined;
    const openSet = db
      .prepare(
        "SELECT COUNT(*) c FROM hypotheses WHERE metric=? AND disposition='open' AND state IN ('proposed','prioritized','blocked')",
      )
      .get(m.name) as { c: number };
    const blockedOnly = db
      .prepare(
        "SELECT COUNT(*) c FROM hypotheses WHERE metric=? AND disposition='open' AND state='blocked'",
      )
      .get(m.name) as { c: number };

    let bet: GapRow["bet"] = null;
    if (active) {
      const day =
        active.activated_at !== null ? Math.max(1, Math.ceil((nowMs - new Date(active.activated_at).getTime()) / 86400_000)) : null;
      const totalDays =
        active.activated_at && active.review_at
          ? Math.round((new Date(active.review_at).getTime() - new Date(active.activated_at).getTime()) / 86400_000)
          : null;
      const deltaSoFar =
        active.baseline_value !== null && m.status_value !== null ? sign * 0 + (m.status_value - active.baseline_value) : null;
      bet = {
        id: active.id,
        state: active.state,
        review_at: active.review_at,
        day,
        total_days: totalDays,
        delta_so_far: deltaSoFar,
        claimed_delta: active.target_delta,
      };
    }

    let classification: GapClass;
    let blocker: string | null = null;
    let nextAction: string;
    if (m.target === null) {
      classification = "unknown";
      nextAction = `set a spec: edit metrics/${m.name}.md (spec.target + spec.deadline)`;
    } else if (freshness === "unknown" || freshness === "error") {
      classification = "unknown";
      blocker = freshness === "error" ? "sensor failing repeatedly" : "never sensed";
      nextAction = freshness === "error" ? `fix the sensor: cronfounder doctor` : `run: cronfounder sense`;
    } else if (gap !== null && gap <= 0) {
      classification = "green";
      nextAction = "nothing — the test passes";
    } else if (active) {
      const reviewDue = active.review_at !== null && new Date(active.review_at).getTime() <= nowMs;
      if (active.state === "paused") {
        classification = "blocked";
        blocker = `bet ${active.id} paused (holds the WIP slot; resume is human-only)`;
        nextAction = `review the urgent card: cronfounder inbox`;
      } else if (reviewDue) {
        classification = "verdict_due";
        nextAction = `run: cronfounder verdict`;
      } else {
        classification = "running";
        nextAction = `wait for review_at ${active.review_at} (sensors are accumulating evidence)`;
      }
    } else if (openSet.c > 0 && blockedOnly.c === openSet.c) {
      classification = "blocked";
      blocker = "all open bets are blocked on prerequisites";
      nextAction = `resolve setup cards: cronfounder inbox`;
    } else if (openSet.c > 0) {
      classification = "needs_decision";
      nextAction = `fund a bet: cronfounder inbox`;
    } else {
      classification = "naked";
      nextAction = `generate bets: cronfounder strategize ${m.name}`;
    }

    rows.push({
      metric: m.name,
      unit: m.unit,
      direction: m.direction,
      value: m.status_value,
      measured_at: m.status_measured_at,
      freshness,
      target: m.target,
      deadline: m.deadline,
      gap,
      gap_pct: gapPct,
      trajectory_per_day: trajectory,
      needed_per_day: neededPerDay,
      bet,
      classification,
      blocker,
      next_action: nextAction,
    });
  }

  return { v: 1, generated_at: iso(), rows };
}
