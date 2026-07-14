/**
 * Adversarial + safety coverage: invariant I overwrite, staging boundary,
 * tripwire → pause → human-only resume, green lane defaults, torn events,
 * json/exit-code contract, locks.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
import path from "node:path";
import { cf, demoCompany, tmpCompany, T0 } from "./helpers.js";
import { cronLines } from "../src/commands/cron.js";

const { dir: root, cleanup } = tmpCompany();
let co: string;

beforeAll(() => {
  co = demoCompany(root);
});
afterAll(cleanup);

describe("invariant I — agents write intentions; sensors write reality", () => {
  it("a hand-edited status is detectably overwritten on the next mutating run", () => {
    const metricFile = path.join(co, "metrics", "demo_signups.md");
    const original = readFileSync(metricFile, "utf8");
    expect(original).toContain("value: 12");
    const forged = original.replace(/value: 12/, "value: 9999");
    writeFileSync(metricFile, forged);
    const r = cf(co, ["sense", "--quiet"], { now: "2026-07-13T18:00:00Z" });
    expect(r.status).toBe(0);
    const after = readFileSync(metricFile, "utf8");
    expect(after).not.toContain("9999");
    expect(after).toContain("value: 12");
  });

  it("human-owned frontmatter edits ARE honored (files are canon for intent)", () => {
    const metricFile = path.join(co, "metrics", "demo_signups.md");
    const edited = readFileSync(metricFile, "utf8").replace(/target: 100/, "target: 150");
    writeFileSync(metricFile, edited);
    const r = cf(co, ["plan", "--json", "--runtime", "none"], { now: "2026-07-13T18:10:00Z" });
    expect(r.status).toBe(0);
    const row = r.json.data.gap.rows.find((x: any) => x.metric === "demo_signups");
    expect(row.target).toBe(150);
    // human_edit event journaled
    const events = readFileSync(path.join(co, "journal", "events", "2026-07-13.jsonl"), "utf8");
    expect(events).toContain("human_edit");
  });
});

describe("staging import boundary", () => {
  it("rejects traversal names, symlinks, duplicate ids and schema-invalid files with reasons", () => {
    // clear the demo funding card so the metric is naked again (strategize is idempotent per gap)
    expect(cf(co, ["resolve", "R-1", "--reject", "--reason", "test reset"], { now: "2026-07-13T18:15:00Z" }).status).toBe(0);
    const dry = cf(co, ["strategize", "demo_signups", "--dry-run", "--json"], { now: "2026-07-13T18:20:00Z" });
    expect(dry.status).toBe(0);
    const staging = dry.json.data.staging_dir;
    // schema-invalid (no kill criteria)
    writeFileSync(
      path.join(staging, "H-20260713-nokill.md"),
      `---\nid: H-20260713-nokill\nmetric: demo_signups\nclaim:\n  summary: a bet that cannot lose\n  target_delta: 10\n  unit: signups\neconomics:\n  cost_tokens: 1\n  cost_human_min: 0\n  risk: none\n  confidence: 0.5\n  confidence_source: guess\nexperiment:\n  duration_days: 7\n  channels:\n    - mock\n  projects:\n    - type: content\n      channel: mock\n      payload_type: text\n      count: 1\n      brief: x\n---\nbody\n`,
    );
    // unknown channel
    writeFileSync(
      path.join(staging, "H-20260713-ghostchan.md"),
      `---\nid: H-20260713-ghostchan\nmetric: demo_signups\nclaim:\n  summary: bet on a channel that does not exist\n  target_delta: 10\n  unit: signups\neconomics:\n  cost_tokens: 1\n  cost_human_min: 0\n  risk: none\n  confidence: 0.5\n  confidence_source: guess\nexperiment:\n  duration_days: 7\n  channels:\n    - ghost\n  projects:\n    - type: content\n      channel: ghost\n      payload_type: text\n      count: 1\n      brief: x\nkill_criteria:\n  min_delta: 3\n  tripwires: []\n---\nbody\n`,
    );
    // symlink attack
    symlinkSync("/etc/hosts", path.join(staging, "H-20260713-symlink.md"));
    // bad name
    writeFileSync(path.join(staging, "not-a-hypothesis.md"), "---\nid: x\n---\n");
    const imp = cf(co, ["run", "import", dry.json.data.run_id, "--json"], { now: "2026-07-13T18:25:00Z" });
    expect(imp.status).toBe(0);
    const rejected = imp.json.data.rejected.map((r: any) => `${r.file}: ${r.reason}`).join("\n");
    expect(rejected).toContain("kill_criteria");
    expect(rejected).toContain("ghost");
    expect(rejected).toContain("symlink");
    expect(rejected).toContain("H-YYYYMMDD-slug");
    expect(imp.json.data.registered).toHaveLength(0);
  });
});

describe("payload_file path traversal (staging boundary — Finding 1)", () => {
  const { dir: troot, cleanup: tcleanup } = tmpCompany();
  let tco: string;
  beforeAll(() => {
    tco = demoCompany(troot);
  });
  afterAll(tcleanup);

  it("rejects a content payload_file that escapes its dir (relative, absolute, windows) and writes nothing outside", () => {
    // fund the seeded demo bet → an active hypothesis with an open build task
    expect(cf(tco, ["resolve", "R-1", "--approve"], { now: T0 }).status).toBe(0);
    // prepare a build run WITHOUT invoking a runtime — the test owns the staging dir
    const dry = cf(tco, ["build", "--dry-run", "--json"], { now: T0 });
    expect(dry.status).toBe(0);
    const bundle = dry.json.data.dry_runs[0];
    expect(bundle).toBeTruthy();
    const staging = bundle.staging_dir as string;
    const rid = bundle.run_id as string;

    const attacks: Array<[string, string]> = [
      ["C-20260713-relesc", "../../.cronfounder/env"], // relative traversal into the human-owned env file
      ["C-20260713-absesc", path.join(troot, "PWNED-abs")], // absolute path
      ["C-20260713-winesc", "..\\..\\evil"], // windows-style separators
    ];
    for (const [id, pf] of attacks) {
      const dir = path.join(staging, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, "meta.md"),
        `---\nid: ${id}\nchannel: mock\npayload_type: text\npayload_file: '${pf}'\nprovenance:\n  task: 1\n  project: 1\n  hypothesis: H-20260713-x\n  metric: demo_signups\n---\nbody\n`,
      );
      // a real regular file so it's containment — not the isFile/symlink guard — that rejects
      writeFileSync(path.join(dir, "payload.txt"), "decoy\n");
    }
    const relTarget = path.join(tco, ".cronfounder", "env"); // where the relative attack would land
    const absTarget = path.join(troot, "PWNED-abs");

    const imp = cf(tco, ["run", "import", rid, "--json"], { now: T0 });
    expect(imp.status).toBe(0);
    // every attack rejected, naming the offending field
    expect(imp.stderr).toContain("payload_file");
    for (const [id] of attacks) expect(imp.stderr).toContain(id);
    // nothing imported, and nothing written outside the content sandbox
    expect(imp.json.data.drafted).toHaveLength(0);
    expect(existsSync(relTarget)).toBe(false);
    expect(existsSync(absTarget)).toBe(false);
    expect(existsSync(path.join(tco, "content", "C-20260713-relesc"))).toBe(false);
  });
});

describe("cron line shell-quoting (Finding 2)", () => {
  // parse a POSIX shell command line and return stdout (proves how a shell tokenizes it)
  const shParse = (script: string) => spawnSync("/bin/sh", ["-c", script], { encoding: "utf8" }).stdout;

  it("a company dir with a space and a single quote round-trips through the shell as one --company arg", () => {
    const dir = "/home/u/acme's co dir";
    const { lines } = cronLines(dir);
    const watch = lines.find((l) => l.startsWith("*/10"))!;
    const cmd = watch.slice(watch.indexOf("/bin/sh")); // "/bin/sh -c '<arg>'"
    // unwrap the OUTER /bin/sh -c '<arg>' → the inner script the wrapper runs
    const inner = shParse(`printf %s ${cmd.slice("/bin/sh -c ".length)}`);
    // pull the single-quoted --company token out of the inner script and unwrap it too
    const token = inner.match(/--company (.*) --cron/)![1]!;
    const companyValue = shParse(`printf %s ${token}`);
    // the shell recovers the exact dir at both nesting levels — no quote breakout, no word-splitting
    expect(companyValue).toBe(dir);
  });

  it("refuses (E_VALIDATION, exit 2) to build cron lines when a path contains a newline", () => {
    try {
      cronLines("/home/u/bad\nname");
      expect.unreachable("cronLines must throw on a newline in the path");
    } catch (e: any) {
      expect(e.code).toBe("E_VALIDATION");
      expect(e.exit).toBe(2);
    }
  });
});

describe("green lane defaults + tripwires", () => {
  it("green lane is OFF by default (budget 0) — nothing auto-activates", () => {
    const r = cf(co, ["plan", "--json", "--runtime", "none"], { now: "2026-07-13T19:00:00Z" });
    expect(r.json.data.green_lane_activated).toHaveLength(0);
  });

  it("tripwire fires → pause + urgent page within one reflex tick; resume is human-only", () => {
    // craft a bet with a tripwire via the dry-run/import path (the agent-native flow)
    const dry = cf(co, ["strategize", "demo_signups", "--dry-run", "--json"], { now: "2026-07-14T09:00:00Z" });
    const staging = dry.json.data.staging_dir;
    writeFileSync(
      path.join(staging, "H-20260714-tripwire-bet.md"),
      `---\nid: H-20260714-tripwire-bet\nmetric: demo_signups\nclaim:\n  summary: post spicy takes for +20 signups in 7 days\n  target_delta: 20\n  unit: signups\neconomics:\n  cost_tokens: 1000\n  cost_human_min: 0\n  risk: reversible\n  confidence: 0.3\n  confidence_source: guess\nexperiment:\n  duration_days: 7\n  channels:\n    - mock\n  projects:\n    - type: content\n      channel: mock\n      payload_type: text\n      count: 1\n      brief: one spicy take\nkill_criteria:\n  min_delta: 5\n  tripwires:\n    - source: mock\n      signal: negative_replies\n      aggregation: count\n      comparator: ">="\n      threshold: 3\n      window_minutes: 120\n      min_samples: 0\n      missing_policy: ignore\n---\n## Theory\nspice moves numbers until it moves the wrong ones.\n`,
    );
    const imp = cf(co, ["run", "import", dry.json.data.run_id, "--json"], { now: "2026-07-14T09:05:00Z" });
    expect(imp.json.data.registered).toContain("H-20260714-tripwire-bet");
    const card = imp.json.data.funding_card;
    expect(cf(co, ["resolve", `R-${card}`, "--choice", "H-20260714-tripwire-bet"], { now: "2026-07-14T09:10:00Z" }).status).toBe(0);
    expect(cf(co, ["build", "--quiet"], { now: "2026-07-14T09:15:00Z" }).status).toBe(0);
    const inbox = cf(co, ["inbox", "--json"], { now: "2026-07-14T09:16:00Z" });
    const contentCard = inbox.json.data.open.find((c: any) => c.kind === "approve_content");
    expect(cf(co, [ "resolve", contentCard.id, "--approve"], { now: "2026-07-14T09:20:00Z" }).status).toBe(0);
    expect(cf(co, ["push", "--quiet"], { now: "2026-07-14T09:25:00Z" }).status).toBe(0);
    // simulate the world responding badly
    const mock = JSON.parse(readFileSync(path.join(co, ".cronfounder", "mock", "mock.json"), "utf8"));
    mock.signals = [
      { id: "n1", signal: "negative_replies", value: 1, at: "2026-07-14T09:30:00Z" },
      { id: "n2", signal: "negative_replies", value: 1, at: "2026-07-14T09:31:00Z" },
      { id: "n3", signal: "negative_replies", value: 1, at: "2026-07-14T09:32:00Z" },
    ];
    writeFileSync(path.join(co, ".cronfounder", "mock", "mock.json"), JSON.stringify(mock));
    const watch = cf(co, ["watch", "--json"], { now: "2026-07-14T09:40:00Z" });
    expect(watch.json.data.tripped).toHaveLength(1);
    // paused + urgent card
    const board = cf(co, ["board", "--json"], { now: "2026-07-14T09:41:00Z" });
    expect(board.json.data.blocked.find((b: any) => b.id === "H-20260714-tripwire-bet").state).toBe("paused");
    const inbox2 = cf(co, ["inbox", "--json"], { now: "2026-07-14T09:42:00Z" });
    const urgent = inbox2.json.data.open.find((c: any) => c.urgent);
    expect(urgent.kind).toBe("decide");
    // resume (human)
    expect(cf(co, ["resolve", urgent.id, "--choice", "resume"], { now: "2026-07-14T09:50:00Z" }).status).toBe(0);
    const board2 = cf(co, ["board", "--json"], { now: "2026-07-14T09:51:00Z" });
    expect(board2.json.data.running.find((b: any) => b.id === "H-20260714-tripwire-bet").state).toBe("measuring");
  });
});

describe("json + exit-code contract (agents are first-class users)", () => {
  it("stdout under --json is exactly one parseable envelope; progress goes to stderr", () => {
    const r = cf(co, ["board", "--json"], { now: "2026-07-14T10:00:00Z" });
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.json.v).toBe(1);
    expect(r.json.ok).toBe(true);
  });
  it("gate refusal envelope carries code/invariant/problem/cause/fix, exit 3", () => {
    const r = cf(co, ["strategize", "demo_signups", "--json"], { now: "2026-07-14T10:01:00Z" });
    expect(r.status).toBe(3);
    expect(r.json.ok).toBe(false);
    expect(r.json.error.invariant).toBe("VIII");
    expect(r.json.error.fix.length).toBeGreaterThan(10);
  });
  it("unknown ids give did-you-mean guidance, exit 2", () => {
    const r = cf(co, ["resolve", "H-20260714-tripwire-bet", "--approve", "--json"], { now: "2026-07-14T10:02:00Z" });
    expect(r.status).toBe(2);
    expect(r.json.error.code).toBe("E_WRONG_ID_KIND");
    expect(r.json.error.fix).toContain("inbox");
  });
});

describe("events integrity", () => {
  it("a torn trailing event line is quarantined, never fatal", () => {
    appendFileSync(path.join(co, "journal", "events", "2026-07-14.jsonl"), '{"id":"torn-line-no-close');
    const r = cf(co, ["board", "--json"], { now: "2026-07-14T11:00:00Z" });
    expect(r.status).toBe(0);
    const sense = cf(co, ["sense", "--quiet"], { now: "2026-07-14T11:01:00Z" });
    expect(sense.status).toBe(0);
    const events = readFileSync(path.join(co, "journal", "events", "2026-07-14.jsonl"), "utf8");
    expect(events).toContain("quarantined_torn_event_lines");
  });
});

describe("locks", () => {
  it("a stale lock (dead pid) is taken over and journaled; cron contention exits 0", () => {
    mkdirSync(path.join(co, ".cronfounder"), { recursive: true });
    writeFileSync(
      path.join(co, ".cronfounder", "lock"),
      JSON.stringify({ pid: 999999, started: "2026-07-14T11:00:00Z", host: hostname(), nonce: "dead", command: "test" }),
    );
    const r = cf(co, ["sense", "--quiet"], { now: "2026-07-14T11:10:00Z" });
    expect(r.status).toBe(0);
  });
});
