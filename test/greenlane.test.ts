/**
 * M6 DoD: a qualifying cheap/safe/ready bet activates untouched and journals
 * its own justification — and the gates that cannot be bought stay shut.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cf, demoCompany, tmpCompany, T0 } from "./helpers.js";

const { dir: root, cleanup } = tmpCompany();
let co: string;

const BET = (id: string, risk: string, tokens: number, humanMin: number, playbook: string | null) => `---
id: ${id}
metric: demo_signups
playbook: ${playbook === null ? "null" : playbook}
claim:
  summary: cheap safe experiment expecting +10 signups in 7 days
  target_delta: 10
  unit: signups
economics:
  cost_tokens: ${tokens}
  cost_human_min: ${humanMin}
  risk: ${risk}
  confidence: 0.3
  confidence_source: guess
experiment:
  duration_days: 7
  channels:
    - mock
  projects:
    - type: content
      channel: mock
      payload_type: text
      count: 1
      brief: a draft variant
kill_criteria:
  min_delta: 3
  tripwires: []
---
## Theory
cheap learning compounds.
`;

beforeAll(() => {
  co = demoCompany(root);
  // reject the demo's funding card so the metric is naked for our fixtures
  expect(cf(co, ["resolve", "R-1", "--reject", "--reason", "fixture reset"], { now: "2026-07-13T12:10:00Z" }).status).toBe(0);
});
afterAll(cleanup);

describe("the green lane (invariant X: risk gates cannot be bought)", () => {
  it("with budget set and a trusted playbook, ONLY the qualifying bet auto-activates", () => {
    // grant the playbook trust (a human act, in writing)
    const pb = path.join(co, "playbooks", "build-in-public.md");
    writeFileSync(pb, readFileSync(pb, "utf8").replace("autonomy: manual", "autonomy: scheduled_with_approval"));
    // set the budget knob (the ONE number that tunes aggressiveness)
    const constitution = path.join(co, "doctrine", "constitution.md");
    writeFileSync(constitution, readFileSync(constitution, "utf8").replace("budget_tokens: 0", "budget_tokens: 5000"));

    // register three bets via the agent-native dry-run/import path:
    const dry = cf(co, ["strategize", "demo_signups", "--dry-run", "--json"], { now: "2026-07-13T13:00:00Z" });
    const staging = dry.json.data.staging_dir;
    writeFileSync(path.join(staging, "H-20260713-cheap-safe-trusted.md"), BET("H-20260713-cheap-safe-trusted", "none", 3000, 0, "build-in-public"));
    writeFileSync(path.join(staging, "H-20260713-cheap-but-risky.md"), BET("H-20260713-cheap-but-risky", "irreversible", 1000, 0, "build-in-public"));
    writeFileSync(path.join(staging, "H-20260713-safe-but-untrusted.md"), BET("H-20260713-safe-but-untrusted", "none", 1000, 0, null));
    const imp = cf(co, ["run", "import", dry.json.data.run_id, "--json"], { now: "2026-07-13T13:05:00Z" });
    expect(imp.json.data.registered).toHaveLength(3);

    // the pulse runs plan → green-lane check
    const plan = cf(co, ["plan", "--json", "--runtime", "none"], { now: "2026-07-13T13:10:00Z" });
    expect(plan.status).toBe(0);
    expect(plan.json.data.green_lane_activated).toEqual(["H-20260713-cheap-safe-trusted"]);

    // it journaled its own justification
    const events = readFileSync(path.join(co, "journal", "events", "2026-07-13.jsonl"), "utf8");
    const activation = events.split("\n").find((l) => l.includes("state_transition") && l.includes("H-20260713-cheap-safe-trusted") && l.includes('"to":"active"'));
    expect(activation).toBeTruthy();
    expect(JSON.parse(activation!).snapshot.green_lane).toBe(true);

    // the irreversible and untrusted bets stayed at the gate
    const board = cf(co, ["board", "--json"], { now: "2026-07-13T13:11:00Z" });
    const waiting = board.json.data.needs_funding.flatMap((g: any) => g.bets.map((b: any) => b.id));
    expect(waiting).toContain("H-20260713-cheap-but-risky");
    expect(waiting).toContain("H-20260713-safe-but-untrusted");
  });

  it("green lane never approves CONTENT — the drafts still stop at the human gate", () => {
    expect(cf(co, ["build", "--quiet"], { now: "2026-07-13T13:20:00Z" }).status).toBe(0);
    const inbox = cf(co, ["inbox", "--json"], { now: "2026-07-13T13:21:00Z" });
    const contentCards = inbox.json.data.open.filter((c: any) => c.kind === "approve_content");
    expect(contentCards.length).toBeGreaterThan(0);
    const push = cf(co, ["push", "--json"], { now: "2026-07-13T13:22:00Z" });
    expect(push.json.action).toBe("push:noop"); // nothing auto-approved
  });
});
