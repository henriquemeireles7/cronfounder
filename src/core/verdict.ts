/**
 * Verdict computation (invariant IX) — pure code over sensor history.
 *
 *   baseline  = the reading frozen at activation (id + value recorded then)
 *   terminal  = the last reading with measured_at ≤ review_at
 *   delta     = direction-adjusted (terminal − baseline)
 *   validated iff delta ≥ kill_criteria.min_delta (direction-adjusted)
 *   inconclusive if no terminal reading exists within the freshness window
 *   before review_at — never auto-judged; a decide card asks the human to
 *   extend once or close.
 *
 * The verdict event freezes reading ids, values and ALGORITHM_V so replay
 * projects the recorded fact and never recomputes history.
 */
export const ALGORITHM_V = 1;

export interface VerdictInput {
  direction: "increase" | "decrease";
  baseline_value: number;
  min_delta: number;
  review_at: string;
  freshness_hours: number;
  readings: Array<{ id: number; value: number; measured_at: string }>; // ascending
}

export type VerdictOutcome =
  | { kind: "verdict"; result: "validated" | "invalidated"; delta: number; terminal: { id: number; value: number; measured_at: string } }
  | { kind: "inconclusive"; reason: string };

export function computeVerdict(input: VerdictInput): VerdictOutcome {
  const reviewMs = new Date(input.review_at).getTime();
  const eligible = input.readings.filter((r) => new Date(r.measured_at).getTime() <= reviewMs);
  const terminal = eligible[eligible.length - 1];
  if (!terminal) {
    return { kind: "inconclusive", reason: "no sensor reading exists at or before review_at" };
  }
  const ageHours = (reviewMs - new Date(terminal.measured_at).getTime()) / 3600_000;
  if (ageHours > input.freshness_hours) {
    return {
      kind: "inconclusive",
      reason: `last reading before review_at is ${Math.round(ageHours)}h old (freshness window: ${input.freshness_hours}h)`,
    };
  }
  const sign = input.direction === "increase" ? 1 : -1;
  const delta = sign * (terminal.value - input.baseline_value);
  const threshold = Math.abs(input.min_delta);
  const result = delta >= threshold ? "validated" : "invalidated";
  return { kind: "verdict", result, delta, terminal };
}
