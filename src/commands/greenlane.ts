/**
 * The green lane (invariant X's counterpart): a bet auto-activates ONLY if
 * ALL hold — cost_tokens ≤ constitution budget · cost_human_min == 0 ·
 * risk == none · ready · playbook autonomy ≥ scheduled_with_approval.
 * Budget defaults to 0 (OFF). The activation event snapshots its own
 * justification. Green lane funds bets — it NEVER approves content.
 */
import { readFm } from "../core/fm.js";
import { ConstitutionSchema, AUTONOMY_LEVELS } from "../core/schema.js";
import { activateHypothesis } from "../core/activate.js";
import { compareByLeverage } from "../core/leverage.js";
import type { Store } from "../core/store.js";
import type { Out } from "../output.js";

export async function greenLaneCheck(store: Store, out: Out): Promise<string[]> {
  const db = store.ledger.db;
  let budget = 0;
  try {
    const fm = await readFm(store.company.paths.constitution);
    budget = ConstitutionSchema.parse(fm.data).auto_activation.budget_tokens;
  } catch {
    return []; // no readable constitution → green lane stays off
  }
  if (budget <= 0) return [];

  const candidates = db
    .prepare(
      `SELECT h.id, h.metric, h.leverage, h.cost_tokens, h.cost_human_min, h.risk, h.ready, h.playbook, p.autonomy
       FROM hypotheses h LEFT JOIN playbooks p ON p.name = h.playbook
       WHERE h.state = 'prioritized' AND h.disposition = 'open'`,
    )
    .all() as Array<{
    id: string;
    metric: string;
    leverage: number | null;
    cost_tokens: number;
    cost_human_min: number;
    risk: string;
    ready: number;
    playbook: string | null;
    autonomy: string | null;
  }>;

  const minAutonomy = AUTONOMY_LEVELS.indexOf("scheduled_with_approval");
  const eligible = candidates.filter(
    (c) =>
      c.cost_tokens <= budget &&
      c.cost_human_min === 0 &&
      c.risk === "none" &&
      c.ready === 1 &&
      c.playbook !== null &&
      c.autonomy !== null &&
      AUTONOMY_LEVELS.indexOf(c.autonomy as (typeof AUTONOMY_LEVELS)[number]) >= minAutonomy,
  );
  eligible.sort((a, b) => compareByLeverage({ leverage: a.leverage ?? 0, id: a.id }, { leverage: b.leverage ?? 0, id: b.id }));

  const activated: string[] = [];
  const takenMetrics = new Set<string>();
  for (const c of eligible) {
    if (takenMetrics.has(c.metric)) continue;
    try {
      const result = await activateHypothesis(store, c.id, "green_lane", "green_lane");
      activated.push(c.id);
      takenMetrics.add(c.metric);
      out.progress(
        `green lane activated ${c.id} (cost ${c.cost_tokens} ≤ budget ${budget}, risk none, ready, playbook trusted) — review at ${result.review_at}`,
      );
    } catch {
      // WIP taken or readiness changed under us — fine, gates said no.
    }
  }
  return activated;
}
