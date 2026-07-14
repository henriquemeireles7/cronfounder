/**
 * verdict — the season clock. Processes EVERY overdue review_at (catch-up
 * after downtime), computes the verdict from sensor history alone (invariant
 * IX), freezes the readings in the event (replay projects, never recomputes),
 * updates playbook track records, and re-strategizes red+naked metrics when
 * a runtime is available.
 */
import { computeVerdict, ALGORITHM_V } from "../core/verdict.js";
import { assertHypothesisTransition } from "../core/states.js";
import { fileRequest } from "../core/inbox.js";
import { computeGapModel } from "../core/gap.js";
import type { Store } from "../core/store.js";
import type { Out } from "../output.js";
import { iso, now } from "../ids.js";
import { selectAdapter } from "../runtime/adapter.js";
import { strategizeMetric } from "./strategize.js";

export interface VerdictResult {
  decided: Array<{ hypothesis: string; result: string; delta: number }>;
  inconclusive: Array<{ hypothesis: string; reason: string; card: number }>;
  restrategized: string[];
  nothing_due: boolean;
}

export async function runVerdict(store: Store, out: Out, opts: { runtime?: string }): Promise<VerdictResult> {
  const db = store.ledger.db;
  const result: VerdictResult = { decided: [], inconclusive: [], restrategized: [], nothing_due: false };
  const due = db
    .prepare(
      "SELECT * FROM hypotheses WHERE state IN ('active','measuring') AND disposition='open' AND review_at IS NOT NULL AND review_at <= ? ORDER BY review_at",
    )
    .all(iso(now())) as any[];
  if (due.length === 0) {
    result.nothing_due = true;
    return result;
  }
  for (const h of due) {
    const metric = db.prepare("SELECT direction FROM metrics WHERE name=?").get(h.metric) as { direction: "increase" | "decrease" } | undefined;
    const readings = db
      .prepare("SELECT id, value, measured_at FROM metric_history WHERE metric=? ORDER BY measured_at ASC, id ASC")
      .all(h.metric) as Array<{ id: number; value: number; measured_at: string }>;
    const outcome = computeVerdict({
      direction: metric?.direction ?? "increase",
      baseline_value: h.baseline_value,
      min_delta: h.min_delta,
      review_at: h.review_at,
      freshness_hours: store.company.config.freshness_hours,
      readings,
    });
    if (outcome.kind === "inconclusive") {
      const existing = db
        .prepare("SELECT id FROM inbox WHERE state='open' AND kind='decide' AND blocking_id=?")
        .get(h.id) as { id: number } | undefined;
      const card =
        existing?.id ??
        (await fileRequest(
          store,
          "core",
          "decide",
          {
            what: `verdict on ${h.id} is INCONCLUSIVE: ${outcome.reason}`,
            why: "a verdict computed from missing data would be an invented fact (invariant IX) — the sensors, not the believers, decide",
            steps: [`fix the sensor if broken: cronfounder doctor`, `then choose below`],
            blocking: `the WIP slot on ${h.metric}`,
            choices: [
              { key: "extend", label: `extend the measurement window once (+${h.duration_days} days)` },
              { key: "close", label: "close inconclusive (frees the metric; no verdict recorded)" },
            ],
            decide_kind: "inconclusive",
            hypothesis: h.id,
          } as any,
          { blockingKind: "hypothesis", blockingId: h.id, urgent: true },
        ));
      result.inconclusive.push({ hypothesis: h.id, reason: outcome.reason, card });
      continue;
    }
    assertHypothesisTransition(h.id, h.state, outcome.result, "verdict");
    const baselineReading = readings.find((r) => r.id === h.baseline_reading) ?? { id: h.baseline_reading, value: h.baseline_value, measured_at: "unknown" };
    await store.commit(
      [
        store.event("verdict", "verdict", {
          hypothesis: h.id,
          result: outcome.result,
          delta: outcome.delta,
          baseline_reading: baselineReading,
          terminal_reading: outcome.terminal,
          algorithm_v: ALGORITHM_V,
        }),
        store.event("verdict", "state_transition", { kind: "hypothesis", subject: h.id, from: h.state, to: outcome.result, actor: "verdict" }),
      ],
      [
        {
          kind: "patch",
          file: h.file_path,
          patches: {
            state: outcome.result,
            verdict: { result: outcome.result, delta: outcome.delta, decided_at: iso(), algorithm_v: ALGORITHM_V },
          },
        },
      ],
      [
        `verdict on ${h.id}: ${outcome.result.toUpperCase()} — measured Δ${outcome.delta >= 0 ? "+" : ""}${outcome.delta} ${h.unit} vs claimed Δ+${h.target_delta} (kill threshold ${h.min_delta}); ${
          outcome.result === "invalidated" ? "the journal just learned, at a known price, which door doesn't open" : "the playbook's track record improves"
        }`,
      ],
    );
    result.decided.push({ hypothesis: h.id, result: outcome.result, delta: outcome.delta });

    // playbook track record mirror (ledger row already updated by projection)
    if (h.playbook) {
      const pb = db.prepare("SELECT file_path, validated, invalidated FROM playbooks WHERE name=?").get(h.playbook) as
        | { file_path: string; validated: number; invalidated: number }
        | undefined;
      if (pb) {
        await store.commit(
          [],
          [
            {
              kind: "patch",
              file: pb.file_path,
              patches: { track_record: { validated: pb.validated, invalidated: pb.invalidated, last_verdict_at: iso() } },
            },
          ],
        );
      }
    }
  }

  // red-and-naked after verdicts → re-strategize (needs a runtime; otherwise the gap report names it)
  const adapter = selectAdapter(store.company, opts.runtime);
  if (adapter) {
    const gap = computeGapModel(store);
    for (const row of gap.rows.filter((r) => r.classification === "naked")) {
      try {
        const res = await strategizeMetric(store, out, row.metric, { runtime: opts.runtime });
        if (!("dry_run" in res)) {
          result.restrategized.push(row.metric);
          out.progress(`re-strategized ${row.metric}: ${res.registered.length} fresh bet(s)`);
        }
      } catch (e) {
        out.progress(`re-strategize ${row.metric} skipped: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
    }
  }
  return result;
}

export async function verdictCommand(store: Store, out: Out, opts: { runtime?: string }): Promise<void> {
  const result = await runVerdict(store, out, opts);
  if (result.nothing_due) {
    out.noop("verdict", "no reviews due — verdicts arrive on schedule, never early (invariant IX)");
  }
  out.ok("verdict", result, () => {
    for (const d of result.decided) {
      out.print(`${d.hypothesis}: ${d.result.toUpperCase()} (Δ ${d.delta >= 0 ? "+" : ""}${d.delta})`);
    }
    for (const i of result.inconclusive) {
      out.print(`${i.hypothesis}: INCONCLUSIVE — ${i.reason} (decide: R-${i.card})`);
    }
    if (result.restrategized.length > 0) out.print(`re-strategized: ${result.restrategized.join(", ")}`);
  });
}
