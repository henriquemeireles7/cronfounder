/**
 * The ledger: SQLite (node:sqlite, zero native deps) as a PROJECTION.
 *
 * Authority sources per column (invariant V, enforced by design):
 *   document rows (metrics, hypotheses, channels, playbooks, contents intent
 *   fields) — authoritative in FILES, imported by the scanner;
 *   state/history/inbox/publication columns — authoritative in EVENTS,
 *   filled only by `project()` during replay.
 *
 * The db is disposable: `rebuild` = scan files + replay events. Corruption
 * costs minutes, never meaning.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { CronfounderError, EXIT, gateRefusal } from "../errors.js";
import type { CfEvent } from "./events.js";
import { EVENT_VERSION } from "./events.js";

export const SCHEMA_VERSION = 1;
export const MIN_READER_VERSION = 1;

const DDL = `
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS applied_events (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS metrics (
  name TEXT PRIMARY KEY, parent TEXT, unit TEXT NOT NULL, direction TEXT NOT NULL,
  sensor_type TEXT NOT NULL, sensor_json TEXT NOT NULL,
  target REAL, deadline TEXT, spec_set_by TEXT, spec_set_at TEXT, baseline_value REAL,
  status_value REAL, status_measured_at TEXT,
  file_path TEXT NOT NULL, human_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metric_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL,
  metric TEXT NOT NULL, value REAL NOT NULL, measured_at TEXT NOT NULL, sensor TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hypotheses (
  id TEXT PRIMARY KEY, metric TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'proposed',
  disposition TEXT NOT NULL DEFAULT 'open', playbook TEXT,
  claim_summary TEXT NOT NULL, target_delta REAL NOT NULL, unit TEXT NOT NULL,
  cost_tokens INTEGER NOT NULL, cost_human_min INTEGER NOT NULL, risk TEXT NOT NULL,
  confidence REAL NOT NULL, confidence_source TEXT NOT NULL,
  duration_days INTEGER NOT NULL, min_delta REAL NOT NULL, tripwires_json TEXT NOT NULL,
  projects_json TEXT NOT NULL, channels_json TEXT NOT NULL,
  leverage REAL, ready INTEGER, missing_json TEXT,
  review_at TEXT, activated_at TEXT, baseline_value REAL, baseline_reading INTEGER,
  verdict_result TEXT, verdict_delta REAL, decided_at TEXT, algorithm_v INTEGER,
  file_path TEXT NOT NULL, human_hash TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS wip_limit ON hypotheses(metric)
  WHERE state IN ('active','measuring','paused') AND disposition = 'open';
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, hypothesis TEXT NOT NULL, type TEXT NOT NULL,
  channel TEXT NOT NULL, payload_type TEXT NOT NULL, builder TEXT NOT NULL,
  brief TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, project INTEGER NOT NULL, kind TEXT NOT NULL, brief TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'todo', claimed_by TEXT, claimed_at TEXT
);
CREATE TABLE IF NOT EXISTS contents (
  id TEXT PRIMARY KEY, channel TEXT NOT NULL, payload_type TEXT NOT NULL,
  payload_file TEXT NOT NULL, task INTEGER NOT NULL, project INTEGER NOT NULL,
  hypothesis TEXT NOT NULL, metric TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft', file_path TEXT NOT NULL, human_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS content_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL, from_state TEXT NOT NULL, to_state TEXT NOT NULL,
  actor TEXT NOT NULL, at TEXT NOT NULL, reason TEXT
);
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open', blocking_kind TEXT, blocking_id TEXT,
  urgent INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  resolved_at TEXT, resolution TEXT, resolved_by TEXT
);
CREATE TABLE IF NOT EXISTS journal_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE,
  at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, refs TEXT NOT NULL,
  file TEXT, line INTEGER
);
CREATE TABLE IF NOT EXISTS watch_windows (
  id INTEGER PRIMARY KEY, content TEXT NOT NULL, hypothesis TEXT NOT NULL,
  channel TEXT NOT NULL, opened_at TEXT NOT NULL, closes_at TEXT NOT NULL,
  tripwires TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS publications (
  intent TEXT PRIMARY KEY, content TEXT NOT NULL, channel TEXT NOT NULL,
  external_id TEXT, state TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, acceptance TEXT NOT NULL, capabilities TEXT NOT NULL,
  cadence_max_per_day INTEGER NOT NULL, credential_ref TEXT, driver_ref TEXT,
  ready INTEGER NOT NULL DEFAULT 0, missing_json TEXT NOT NULL DEFAULT '[]',
  file_path TEXT NOT NULL, human_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS playbooks (
  name TEXT PRIMARY KEY, autonomy TEXT NOT NULL DEFAULT 'manual',
  validated INTEGER NOT NULL DEFAULT 0, invalidated INTEGER NOT NULL DEFAULT 0,
  last_verdict_at TEXT, file_path TEXT NOT NULL, human_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sensor_failures (
  metric TEXT PRIMARY KEY, consecutive INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_at TEXT
);
`;

export class Ledger {
  readonly db: DatabaseSync;

  constructor(readonly dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA foreign_keys=ON");
    this.db.exec("PRAGMA busy_timeout=5000");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(DDL);
    const row = this.db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get() as
      | { value: string }
      | undefined;
    if (row === undefined) {
      const ins = this.db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)");
      ins.run("schema_version", String(SCHEMA_VERSION));
      ins.run("min_reader_version", String(MIN_READER_VERSION));
    } else {
      const found = Number(row.value);
      if (found > SCHEMA_VERSION) {
        throw new CronfounderError({
          code: "E_SCHEMA_NEWER",
          exit: EXIT.ERROR,
          problem: `company.db schema is v${found}, but this cronfounder only understands v${SCHEMA_VERSION}`,
          cause: "a newer cronfounder wrote this ledger (perhaps from another machine or an upgraded cron install)",
          fix: "upgrade this cronfounder installation; read-only commands (board, inbox) may still work",
        });
      }
    }
  }

  close(): void {
    this.db.close();
  }

  applied(eventId: string): boolean {
    return this.db.prepare("SELECT 1 FROM applied_events WHERE id=?").get(eventId) !== undefined;
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      throw e;
    }
  }

  /**
   * Project one event into the ledger. MUST be idempotent: guarded by
   * applied_events. Called inside a transaction.
   */
  project(e: CfEvent): void {
    if (typeof e.v === "number" && e.v > EVENT_VERSION) {
      throw new CronfounderError({
        code: "E_EVENT_NEWER",
        exit: EXIT.ERROR,
        problem: `event ${e.id} has version ${e.v}, newer than this cronfounder understands (${EVENT_VERSION})`,
        cause: "a newer cronfounder appended events to this company",
        fix: "upgrade this installation before mutating; historical events are never rewritten",
      });
    }
    if (this.applied(e.id)) return;
    const p = e as CfEvent & Record<string, any>;
    switch (e.type) {
      case "company_initialized":
      case "journal_note":
      case "human_edit":
      case "artifact_registered":
        break; // journal_index row below is the projection
      case "sensor_reading": {
        this.db
          .prepare("INSERT OR IGNORE INTO metric_history (event_id, metric, value, measured_at, sensor) VALUES (?,?,?,?,?)")
          .run(e.id, p.metric, p.value, p.measured_at, p.sensor);
        this.db
          .prepare("UPDATE metrics SET status_value=?, status_measured_at=? WHERE name=?")
          .run(p.value, p.measured_at, p.metric);
        this.db.prepare("DELETE FROM sensor_failures WHERE metric=?").run(p.metric);
        break;
      }
      case "sensor_failure": {
        this.db
          .prepare(
            `INSERT INTO sensor_failures (metric, consecutive, last_error, last_at) VALUES (?,1,?,?)
             ON CONFLICT(metric) DO UPDATE SET consecutive=consecutive+1, last_error=excluded.last_error, last_at=excluded.last_at`,
          )
          .run(p.metric, p.error, e.at);
        break;
      }
      case "spec_set": {
        this.db
          .prepare("UPDATE metrics SET target=?, deadline=?, spec_set_by=?, spec_set_at=?, baseline_value=? WHERE name=?")
          .run(p.target, p.deadline, p.set_by, e.at, p.baseline_value ?? null, p.metric);
        break;
      }
      case "state_transition": {
        if (p.kind === "hypothesis") {
          this.db
            .prepare(
              `UPDATE hypotheses SET state=?,
                 activated_at=COALESCE(?, activated_at),
                 review_at=COALESCE(?, review_at),
                 baseline_value=COALESCE(?, baseline_value),
                 baseline_reading=COALESCE(?, baseline_reading),
                 leverage=COALESCE(?, leverage),
                 ready=COALESCE(?, ready),
                 missing_json=COALESCE(?, missing_json)
               WHERE id=?`,
            )
            .run(
              p.to,
              p.activated_at ?? null,
              p.review_at ?? null,
              p.baseline_value ?? null,
              p.baseline_reading ?? null,
              p.leverage ?? null,
              p.ready === undefined ? null : p.ready ? 1 : 0,
              p.missing === undefined ? null : JSON.stringify(p.missing),
              p.subject,
            );
        } else if (p.kind === "content") {
          this.db.prepare("UPDATE contents SET state=? WHERE id=?").run(p.to, p.subject);
          this.db
            .prepare(
              "INSERT OR IGNORE INTO content_transitions (event_id, content, from_state, to_state, actor, at, reason) VALUES (?,?,?,?,?,?,?)",
            )
            .run(e.id, p.subject, p.from, p.to, p.actor_name ?? e.actor, e.at, p.reason ?? null);
        } else if (p.kind === "project") {
          this.db.prepare("UPDATE projects SET state=? WHERE id=?").run(p.to, Number(p.subject));
        }
        break;
      }
      case "disposition_change": {
        this.db.prepare("UPDATE hypotheses SET disposition=? WHERE id=?").run(p.disposition, p.subject);
        break;
      }
      case "compiled": {
        for (const pr of p.projects as any[]) {
          this.db
            .prepare(
              "INSERT OR IGNORE INTO projects (id, hypothesis, type, channel, payload_type, builder, brief) VALUES (?,?,?,?,?,?,?)",
            )
            .run(pr.id, p.hypothesis, pr.type, pr.channel, pr.payload_type, pr.builder, pr.brief);
        }
        for (const t of p.tasks as any[]) {
          this.db
            .prepare("INSERT OR IGNORE INTO tasks (id, project, kind, brief) VALUES (?,?,?,?)")
            .run(t.id, t.project, t.kind, t.brief);
        }
        break;
      }
      case "task_event": {
        this.db
          .prepare("UPDATE tasks SET state=?, claimed_by=?, claimed_at=? WHERE id=?")
          .run(p.to, p.claimed_by ?? null, p.to === "claimed" ? e.at : null, Number(p.task));
        break;
      }
      case "inbox_created": {
        this.db
          .prepare(
            "INSERT OR IGNORE INTO inbox (id, kind, payload, blocking_kind, blocking_id, urgent, created_at) VALUES (?,?,?,?,?,?,?)",
          )
          .run(Number(p.request), p.kind, JSON.stringify(p.payload ?? {}), p.blocking_kind ?? null, p.blocking_id ?? null, p.urgent ? 1 : 0, e.at);
        break;
      }
      case "inbox_resolved": {
        this.db
          .prepare("UPDATE inbox SET state='done', resolved_at=?, resolution=?, resolved_by=? WHERE id=?")
          .run(e.at, p.resolution, e.actor, Number(p.request));
        break;
      }
      case "push_intent": {
        this.db
          .prepare("INSERT OR IGNORE INTO publications (intent, content, channel, state, at) VALUES (?,?,?,'intent',?)")
          .run(p.intent, p.content, p.channel, e.at);
        break;
      }
      case "publication": {
        this.db
          .prepare("UPDATE publications SET state='published', external_id=?, at=? WHERE intent=?")
          .run(p.external_id ?? null, e.at, p.intent);
        break;
      }
      case "push_uncertain": {
        this.db.prepare("UPDATE publications SET state='uncertain', at=? WHERE intent=?").run(e.at, p.intent);
        break;
      }
      case "push_resolved": {
        this.db
          .prepare("UPDATE publications SET state=?, external_id=COALESCE(?, external_id), at=? WHERE intent=?")
          .run(p.outcome === "published" ? "published" : "failed", p.external_id ?? null, e.at, p.intent);
        break;
      }
      case "watch_opened": {
        this.db
          .prepare(
            "INSERT OR IGNORE INTO watch_windows (id, content, hypothesis, channel, opened_at, closes_at, tripwires) VALUES (?,?,?,?,?,?,?)",
          )
          .run(Number(p.window), p.content, p.hypothesis, p.channel, p.opened_at, p.closes_at, JSON.stringify(p.tripwires ?? []));
        break;
      }
      case "watch_closed": {
        this.db.prepare("UPDATE watch_windows SET state=? WHERE id=?").run(p.outcome === "tripped" ? "tripped" : "closed", Number(p.window));
        break;
      }
      case "tripwire_fired":
        break; // pause arrives as its own state_transition; journal row below
      case "verdict": {
        this.db
          .prepare("UPDATE hypotheses SET verdict_result=?, verdict_delta=?, decided_at=?, algorithm_v=? WHERE id=?")
          .run(p.result, p.delta, e.at, p.algorithm_v, p.hypothesis);
        const hyp = this.db.prepare("SELECT playbook FROM hypotheses WHERE id=?").get(p.hypothesis) as
          | { playbook: string | null }
          | undefined;
        if (hyp?.playbook) {
          const col = p.result === "validated" ? "validated" : "invalidated";
          this.db
            .prepare(`UPDATE playbooks SET ${col}=${col}+1, last_verdict_at=? WHERE name=?`)
            .run(e.at, hyp.playbook);
        }
        break;
      }
      default:
        break; // unknown-but-not-newer types are tolerated (forward-tolerant reads)
    }
    // Every event lands in the queryable journal index.
    this.db
      .prepare("INSERT OR IGNORE INTO journal_index (event_id, at, actor, action, refs) VALUES (?,?,?,?,?)")
      .run(e.id, e.at, e.actor, e.type, JSON.stringify(refsOf(e)));
    this.db.prepare("INSERT OR IGNORE INTO applied_events (id) VALUES (?)").run(e.id);
  }

  /** Translate the WIP unique-index violation into its invariant refusal. */
  static wipRefusal(metric: string, holder: string): CronfounderError {
    return gateRefusal({
      code: "E_WIP_LIMIT",
      invariant: "VIII",
      invariantText: "one active hypothesis per metric — attribution before ambition",
      problem: `metric "${metric}" already has an active bet (${holder})`,
      fix: `wait for ${holder} to reach its verdict (see: cronfounder board), or bet on a different metric`,
    });
  }
}

/**
 * Read-only lookup for callers that must not hold the ledger open (sensors).
 * The publications table's shape and states are owned here, next to the
 * projection that writes them.
 */
export function readPublishedExternalId(dbPath: string, contentId: string): string | undefined {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db
      .prepare(
        "SELECT external_id FROM publications WHERE content=? AND state='published' AND external_id IS NOT NULL ORDER BY at DESC LIMIT 1",
      )
      .get(contentId) as { external_id: string } | undefined;
    return row?.external_id;
  } finally {
    db.close();
  }
}

function refsOf(e: CfEvent & Record<string, any>): string[] {
  const refs: string[] = [];
  for (const k of ["metric", "hypothesis", "content", "subject", "request", "window", "intent"]) {
    const v = e[k];
    if (typeof v === "string" || typeof v === "number") refs.push(`${k}:${v}`);
  }
  return refs;
}
