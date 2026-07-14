/**
 * Explicit transition tables. Every state change in the system passes
 * through `assertTransition`, which throws a gate refusal naming the
 * invariant when the move is illegal. `blocked` and `paused` are branches,
 * not stages; disposition (open/rejected/closed_inconclusive) is orthogonal
 * so the spec's state machine is never extended with invented states.
 */
import { gateRefusal } from "../errors.js";
import type { ContentState, HypothesisState } from "./schema.js";

type Actor = "human" | "core" | "green_lane" | "watchdog" | "verdict";

interface Transition<S extends string> {
  from: S;
  to: S;
  actors: Actor[];
}

const HYPOTHESIS_TRANSITIONS: Transition<HypothesisState>[] = [
  { from: "proposed", to: "prioritized", actors: ["core"] }, // leverage scored + gates evaluated
  { from: "proposed", to: "blocked", actors: ["core"] }, // readiness gate: missing prerequisites
  { from: "prioritized", to: "blocked", actors: ["core"] },
  { from: "blocked", to: "prioritized", actors: ["core"] }, // prerequisites resolved
  { from: "prioritized", to: "active", actors: ["human", "green_lane"] }, // funding — approval is ignition
  { from: "active", to: "measuring", actors: ["core"] }, // all projects complete, clock running
  { from: "active", to: "paused", actors: ["watchdog", "human"] },
  { from: "measuring", to: "paused", actors: ["watchdog", "human"] },
  { from: "paused", to: "active", actors: ["human"] }, // resume is human-only
  { from: "paused", to: "measuring", actors: ["human"] },
  { from: "measuring", to: "validated", actors: ["verdict"] },
  { from: "measuring", to: "invalidated", actors: ["verdict"] },
  { from: "active", to: "validated", actors: ["verdict"] }, // review_at can arrive before projects finish
  { from: "active", to: "invalidated", actors: ["verdict"] },
];

const CONTENT_TRANSITIONS: Transition<ContentState>[] = [
  { from: "draft", to: "pending_approval", actors: ["core"] }, // builder finishes a draft
  { from: "pending_approval", to: "approved", actors: ["human"] }, // ONLY the human crosses the gate
  { from: "pending_approval", to: "draft", actors: ["human"] }, // rejection sends it back, with reason
  { from: "approved", to: "published", actors: ["core"] }, // push records the publication
];

export type TaskState = "todo" | "claimed" | "done" | "abandoned";
const TASK_TRANSITIONS: Transition<TaskState>[] = [
  { from: "todo", to: "claimed", actors: ["core"] },
  { from: "claimed", to: "done", actors: ["core"] },
  { from: "claimed", to: "todo", actors: ["core"] }, // stale claim reset by next build under the lock
  { from: "claimed", to: "abandoned", actors: ["core", "human"] },
  { from: "todo", to: "abandoned", actors: ["core", "human"] },
];

export type ProjectState = "open" | "done" | "abandoned";
const PROJECT_TRANSITIONS: Transition<ProjectState>[] = [
  { from: "open", to: "done", actors: ["core"] },
  { from: "open", to: "abandoned", actors: ["core", "human"] },
];

const INVARIANT_TEXT: Record<string, string> = {
  III: "nothing side-effectful skips the gate",
  VIII: "one active hypothesis per metric — attribution before ambition",
  IX: "verdicts come from sensors, on schedule",
};

function check<S extends string>(
  table: Transition<S>[],
  kind: string,
  id: string,
  from: S,
  to: S,
  actor: Actor,
  invariant: string,
): void {
  const t = table.find((t) => t.from === from && t.to === to);
  if (!t) {
    throw gateRefusal({
      code: "E_ILLEGAL_TRANSITION",
      invariant,
      invariantText: INVARIANT_TEXT[invariant] ?? "state machines are enforced by the core",
      problem: `${kind} ${id} cannot move ${from} → ${to}`,
      fix: `legal moves from '${from}': ${table.filter((x) => x.from === from).map((x) => x.to).join(", ") || "(none — terminal state)"}`,
    });
  }
  if (!t.actors.includes(actor)) {
    throw gateRefusal({
      code: "E_WRONG_ACTOR",
      invariant,
      invariantText: INVARIANT_TEXT[invariant] ?? "state machines are enforced by the core",
      problem: `${kind} ${id}: ${from} → ${to} may only be performed by ${t.actors.join(" or ")}, not ${actor}`,
      fix:
        to === "approved"
          ? `a human must release it: cronfounder resolve <R-id> --approve`
          : `perform the transition through its owning command`,
    });
  }
}

export function assertHypothesisTransition(id: string, from: HypothesisState, to: HypothesisState, actor: Actor): void {
  const invariant = to === "validated" || to === "invalidated" ? "IX" : "VIII";
  check(HYPOTHESIS_TRANSITIONS, "hypothesis", id, from, to, actor, invariant);
}

export function assertContentTransition(id: string, from: ContentState, to: ContentState, actor: Actor): void {
  check(CONTENT_TRANSITIONS, "content", id, from, to, actor, "III");
}

export function assertTaskTransition(id: string, from: TaskState, to: TaskState, actor: Actor): void {
  check(TASK_TRANSITIONS, "task", id, from, to, actor, "VI");
}

export function assertProjectTransition(id: string, from: ProjectState, to: ProjectState, actor: Actor): void {
  check(PROJECT_TRANSITIONS, "project", id, from, to, actor, "VI");
}
