/**
 * Terminal renderers — dumb formatters over the view-models. Status is never
 * encoded by color alone; ANSI control characters in model text are stripped
 * before rendering.
 */
import { sem } from "../output.js";
import type { BoardModel, InboxModel } from "./viewmodel.js";
import type { GapModel } from "../core/gap.js";

export function clean(s: string): string {
  // strip ANSI escapes and control chars from any model-authored text
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
}

function money(tokens: number, humanMin: number): string {
  const t = tokens >= 1000 ? `${Math.round(tokens / 1000)}k tokens` : `${tokens} tokens`;
  return humanMin > 0 ? `${t} + ${humanMin} human-min` : t;
}

export function renderBoardTerminal(b: BoardModel): string {
  const out: string[] = [];
  out.push(sem.bold("BOARD") + sem.dim(`  generated ${b.generated_at}`));
  out.push("");
  out.push(sem.bold("① NEEDS FUNDING") + sem.dim("  (leverage-ranked within each gap; gates cannot be bought)"));
  if (b.needs_funding.length === 0) out.push(sem.dim("  nothing awaiting a decision"));
  for (const g of b.needs_funding) {
    out.push(`  ${sem.spec(g.metric)}${g.gap !== null ? sem.dim(`  gap: ${g.gap}`) : ""}`);
    for (const bet of g.bets) {
      out.push(
        `    ${sem.bet(bet.id)} [${bet.state}] ${clean(bet.claim)}`,
      );
      out.push(
        sem.dim(
          `      risk:${bet.risk} · cost:${money(bet.cost_tokens, bet.cost_human_min)} · confidence:${bet.confidence} (${bet.confidence_source}) · leverage:${bet.leverage?.toExponential(2) ?? "—"}${bet.missing.length > 0 ? ` · missing: ${bet.missing.join("; ")}` : ""}`,
        ),
      );
    }
  }
  out.push("");
  out.push(sem.bold("② RUNNING / MEASURING") + sem.dim("  (ordered by review date)"));
  if (b.running.length === 0) out.push(sem.dim("  no live experiments"));
  for (const bet of b.running) {
    const progress =
      bet.day !== null && bet.total_days !== null
        ? `day ${bet.day}/${bet.total_days}` +
          (bet.delta_so_far !== null ? ` · ${bet.delta_so_far >= 0 ? "+" : ""}${Math.round(bet.delta_so_far * 100) / 100} of claimed ${bet.claimed_delta >= 0 ? "+" : ""}${bet.claimed_delta} ${bet.unit}` : "")
        : "";
    out.push(`  ${sem.bet(bet.id)} [${bet.state}] on ${sem.spec(bet.metric)} ${sem.dim(progress)}`);
    out.push(sem.dim(`      verdict due ${bet.review_at ?? "—"} — sensors decide, not the believers`));
  }
  out.push("");
  out.push(sem.bold("③ BLOCKED / PAUSED"));
  if (b.blocked.length === 0) out.push(sem.dim("  none"));
  for (const bet of b.blocked) {
    out.push(
      `  ${sem.bet(bet.id)} [${bet.state}] on ${sem.spec(bet.metric)}${bet.state === "paused" ? sem.dim("  holds the WIP slot; resume is human-only → cronfounder inbox") : bet.missing.length > 0 ? sem.dim(`  missing: ${bet.missing.join("; ")}`) : ""}`,
    );
  }
  out.push("");
  out.push(sem.bold("④ RECENT VERDICTS"));
  if (b.recent_verdicts.length === 0) out.push(sem.dim("  none yet — verdicts are how the journal learns"));
  for (const bet of b.recent_verdicts) {
    const v = bet.verdict === "validated" ? sem.status("validated") : bet.verdict === "invalidated" ? sem.bet("invalidated") : sem.dim("inconclusive");
    out.push(
      `  ${bet.id} ${v}${bet.verdict_delta !== null ? sem.dim(` (Δ ${bet.verdict_delta >= 0 ? "+" : ""}${bet.verdict_delta} ${bet.unit} vs claimed ${bet.claimed_delta >= 0 ? "+" : ""}${bet.claimed_delta})`) : ""} ${sem.dim(bet.decided_at ?? "")}`,
    );
  }
  return out.join("\n");
}

export function renderInboxTerminal(i: InboxModel): string {
  const out: string[] = [];
  out.push(sem.bold("INBOX") + sem.dim(`  generated ${i.generated_at}`));
  out.push("");
  if (i.open.length === 0) {
    out.push(sem.status("Nothing needs you."));
    out.push(
      sem.dim(
        `${i.running_bets} bet(s) running.${i.next_review ? ` Next verdict due ${i.next_review}.` : ""} The system works while you're not looking.`,
      ),
    );
    return out.join("\n");
  }
  for (const c of i.open) {
    out.push(`${c.urgent ? sem.bet("🚨 URGENT ") : ""}${sem.bold(c.id)} · ${c.kind} ${sem.dim(c.created_at)}`);
    out.push(`  what:     ${clean(c.what)}`);
    out.push(`  why:      ${clean(c.why)}`);
    if (c.steps.length > 0) {
      out.push(`  steps:`);
      c.steps.forEach((s, n) => out.push(`    ${n + 1}. ${clean(s)}`));
    }
    if (c.choices.length > 0) {
      out.push(`  choices:`);
      for (const ch of c.choices) out.push(`    ${sem.bet(ch.key)} — ${clean(ch.label)}${ch.detail ? sem.dim(` (${clean(ch.detail)})`) : ""}`);
    }
    out.push(`  blocking: ${clean(c.blocking)}`);
    if (c.context) out.push(sem.dim(`  context (agent-written, verify before trusting): ${clean(c.context).slice(0, 300)}`));
    out.push(`  ${sem.bold("→ " + c.resolve_hint)}`);
    out.push("");
  }
  return out.join("\n");
}

export function renderGapTerminal(g: GapModel): string {
  const out: string[] = [];
  out.push(sem.bold("GAP REPORT") + sem.dim(`  generated ${g.generated_at}  (the failing tests of the business)`));
  out.push("");
  const groups: Array<[string, string]> = [
    ["naked", "NAKED — failing, no bet"],
    ["needs_decision", "NEEDS DECISION — bets await funding"],
    ["verdict_due", "VERDICT DUE"],
    ["running", "RUNNING"],
    ["blocked", "BLOCKED"],
    ["green", "GREEN — passing"],
    ["unknown", "UNKNOWN — no spec or no reading"],
  ];
  for (const [key, title] of groups) {
    const rows = g.rows.filter((r) => r.classification === key);
    if (rows.length === 0) continue;
    out.push(sem.bold(title));
    for (const r of rows) {
      const fresh =
        r.freshness === "fresh" ? sem.status(r.freshness) : r.freshness === "stale" ? sem.spec("STALE") : sem.bet(r.freshness.toUpperCase());
      const value = r.value === null ? sem.dim("unknown") : String(r.value);
      const target = r.target === null ? sem.dim("no spec") : `${r.target} by ${r.deadline ?? "—"}`;
      out.push(
        `  ${sem.spec(r.metric.padEnd(20))} ${sem.status(value.padStart(10))} / ${target}  [${fresh}${r.measured_at ? sem.dim(` ${r.measured_at}`) : ""}]`,
      );
      const detail: string[] = [];
      if (r.gap !== null && r.gap > 0) detail.push(`gap ${r.gap}${r.gap_pct !== null ? ` (${r.gap_pct}%)` : ""}`);
      if (r.needed_per_day !== null) detail.push(`needs ${r.needed_per_day}/day`);
      if (r.trajectory_per_day !== null) detail.push(`trending ${r.trajectory_per_day >= 0 ? "+" : ""}${r.trajectory_per_day}/day`);
      if (r.bet) detail.push(`bet ${r.bet.id} [${r.bet.state}]${r.bet.day && r.bet.total_days ? ` day ${r.bet.day}/${r.bet.total_days}` : ""}`);
      if (r.blocker) detail.push(`blocker: ${r.blocker}`);
      if (detail.length > 0) out.push(sem.dim(`      ${detail.join(" · ")}`));
      out.push(`      ${sem.bold("→")} ${r.next_action}`);
    }
    out.push("");
  }
  return out.join("\n");
}
