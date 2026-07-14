/**
 * Leverage scoring — frozen formula (deterministic board order):
 *   impact_norm = |claim.target_delta| / gap        (gap ≤ 0 ⇒ metric not naked; strategize refuses)
 *   cost_norm   = max(1, cost_tokens + cost_human_min × 1000)
 *   leverage    = impact_norm × confidence / cost_norm
 * Ties break by hypothesis id (stable). The human-minute conversion (1 min =
 * 1000 tokens) is a documented constant, not a market claim.
 */
export const HUMAN_MIN_TOKEN_EQUIV = 1000;

export function leverage(opts: {
  target_delta: number;
  gap: number;
  confidence: number;
  cost_tokens: number;
  cost_human_min: number;
}): number {
  const gap = Math.abs(opts.gap);
  if (gap === 0) return 0;
  const impact = Math.abs(opts.target_delta) / gap;
  const cost = Math.max(1, opts.cost_tokens + opts.cost_human_min * HUMAN_MIN_TOKEN_EQUIV);
  return (impact * opts.confidence) / cost;
}

export function compareByLeverage(a: { leverage: number; id: string }, b: { leverage: number; id: string }): number {
  if (b.leverage !== a.leverage) return b.leverage - a.leverage;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
