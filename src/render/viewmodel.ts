/**
 * One versioned view-model; terminal and HTML are dumb formatters over it
 * (JSON is the source). Board = four sections, never ranked across sections.
 */
import type { Store } from "../core/store.js";
import { compareByLeverage } from "../core/leverage.js";
import { iso } from "../ids.js";

export interface BoardBet {
  id: string;
  metric: string;
  state: string;
  claim: string;
  risk: string;
  cost_tokens: number;
  cost_human_min: number;
  confidence: number;
  confidence_source: string;
  leverage: number | null;
  review_at: string | null;
  day: number | null;
  total_days: number | null;
  delta_so_far: number | null;
  claimed_delta: number;
  unit: string;
  missing: string[];
  verdict: string | null;
  verdict_delta: number | null;
  decided_at: string | null;
}

export interface BoardModel {
  v: 1;
  generated_at: string;
  needs_funding: Array<{ metric: string; gap: number | null; bets: BoardBet[] }>;
  running: BoardBet[];
  blocked: BoardBet[];
  recent_verdicts: BoardBet[];
}

export function computeBoard(store: Store): BoardModel {
  const db = store.ledger.db;
  const nowMs = Date.now();
  const all = db
    .prepare(
      `SELECT h.*, m.direction AS m_direction, m.target AS m_target, m.status_value AS m_value
       FROM hypotheses h LEFT JOIN metrics m ON m.name = h.metric
       WHERE h.disposition = 'open' OR h.decided_at IS NOT NULL OR h.disposition='closed_inconclusive'`,
    )
    .all() as any[];

  const toBet = (h: any): BoardBet => {
    const day = h.activated_at ? Math.max(1, Math.ceil((nowMs - new Date(h.activated_at).getTime()) / 86400_000)) : null;
    const totalDays =
      h.activated_at && h.review_at
        ? Math.round((new Date(h.review_at).getTime() - new Date(h.activated_at).getTime()) / 86400_000)
        : null;
    const deltaSoFar = h.baseline_value !== null && h.m_value !== null ? h.m_value - h.baseline_value : null;
    return {
      id: h.id,
      metric: h.metric,
      state: h.state,
      claim: h.claim_summary,
      risk: h.risk,
      cost_tokens: h.cost_tokens,
      cost_human_min: h.cost_human_min,
      confidence: h.confidence,
      confidence_source: h.confidence_source,
      leverage: h.leverage,
      review_at: h.review_at,
      day,
      total_days: totalDays,
      delta_so_far: deltaSoFar,
      claimed_delta: h.target_delta,
      unit: h.unit,
      missing: h.missing_json ? (JSON.parse(h.missing_json) as string[]) : [],
      verdict: h.verdict_result,
      verdict_delta: h.verdict_delta,
      decided_at: h.decided_at,
    };
  };

  const open = all.filter((h) => h.disposition === "open");
  const proposedByMetric = new Map<string, BoardBet[]>();
  for (const h of open.filter((x) => x.state === "proposed" || x.state === "prioritized")) {
    const list = proposedByMetric.get(h.metric) ?? [];
    list.push(toBet(h));
    proposedByMetric.set(h.metric, list);
  }
  const needsFunding = [...proposedByMetric.entries()].map(([metric, bets]) => {
    const m = all.find((h) => h.metric === metric);
    const sign = m?.m_direction === "decrease" ? -1 : 1;
    const gap = m && m.m_target !== null && m.m_value !== null ? sign * (m.m_target - m.m_value) : null;
    bets.sort((a, b) => compareByLeverage({ leverage: a.leverage ?? 0, id: a.id }, { leverage: b.leverage ?? 0, id: b.id }));
    return { metric, gap, bets };
  });
  needsFunding.sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0));

  const running = open
    .filter((x) => x.state === "active" || x.state === "measuring")
    .map(toBet)
    .sort((a, b) => (a.review_at ?? "9999").localeCompare(b.review_at ?? "9999"));
  const blocked = open.filter((x) => x.state === "blocked" || x.state === "paused").map(toBet);
  const recentVerdicts = all
    .filter((x) => x.verdict_result !== null || x.disposition === "closed_inconclusive")
    .map(toBet)
    .sort((a, b) => (b.decided_at ?? "").localeCompare(a.decided_at ?? ""))
    .slice(0, 10);

  return { v: 1, generated_at: iso(), needs_funding: needsFunding, running, blocked, recent_verdicts: recentVerdicts };
}

export interface InboxCardVm {
  id: string;
  kind: string;
  urgent: boolean;
  created_at: string;
  what: string;
  why: string;
  steps: string[];
  blocking: string;
  choices: Array<{ key: string; label: string; detail?: string }>;
  context: string | null;
  resolve_hint: string;
}

export interface InboxModel {
  v: 1;
  generated_at: string;
  open: InboxCardVm[];
  running_bets: number;
  next_review: string | null;
}

export function computeInbox(store: Store): InboxModel {
  const db = store.ledger.db;
  const rows = db
    .prepare("SELECT id, kind, payload, urgent, created_at FROM inbox WHERE state='open' ORDER BY urgent DESC, id ASC")
    .all() as Array<{ id: number; kind: string; payload: string; urgent: number; created_at: string }>;
  const open = rows.map((r) => {
    const p = JSON.parse(r.payload) as Record<string, any>;
    const hint =
      r.kind === "approve_hypothesis"
        ? `cronfounder resolve R-${r.id} --approve | --choice <H-id> | --reject`
        : r.kind === "approve_content"
          ? `cronfounder resolve R-${r.id} --approve | --reject`
          : r.kind === "decide"
            ? `cronfounder resolve R-${r.id} --choice <key>`
            : `cronfounder resolve R-${r.id} --done`;
    return {
      id: `R-${r.id}`,
      kind: r.kind,
      urgent: r.urgent === 1,
      created_at: r.created_at,
      what: String(p.what ?? ""),
      why: String(p.why ?? ""),
      steps: (p.steps ?? []) as string[],
      blocking: String(p.blocking ?? ""),
      choices: (p.choices ?? []) as InboxCardVm["choices"],
      context: p.context ? String(p.context) : null,
      resolve_hint: hint,
    };
  });
  const running = db
    .prepare("SELECT COUNT(*) c FROM hypotheses WHERE state IN ('active','measuring') AND disposition='open'")
    .get() as { c: number };
  const nextReview = db
    .prepare("SELECT MIN(review_at) r FROM hypotheses WHERE state IN ('active','measuring') AND disposition='open'")
    .get() as { r: string | null };
  return { v: 1, generated_at: iso(), open, running_bets: running.c, next_review: nextReview.r };
}
