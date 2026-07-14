/**
 * rebuild — invariant V, executable. Reconstructs the ledger from files +
 * events under the exclusive lock: drop projections → scan documents →
 * replay every event shard → repair file mirrors → checkpoint WAL.
 * If company.db vanished, you lost convenience, never meaning.
 */
import { readAllEvents } from "../core/events.js";
import { scanDocuments, repairMirrors } from "../core/scan.js";
import type { Store } from "../core/store.js";
import type { Out } from "../output.js";

const PROJECTION_TABLES = [
  "applied_events",
  "metrics",
  "metric_history",
  "hypotheses",
  "projects",
  "tasks",
  "contents",
  "content_transitions",
  "inbox",
  "journal_index",
  "watch_windows",
  "publications",
  "channels",
  "playbooks",
  "sensor_failures",
];

/** Canonical dump for equivalence checks (schema + ordered rows, never file bytes). */
export function canonicalDump(store: Store): string {
  const db = store.ledger.db;
  const out: string[] = [];
  for (const table of PROJECTION_TABLES) {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
    const canon = rows
      .map((r) => JSON.stringify(cols.map((c) => r[c] ?? null)))
      .sort();
    out.push(`## ${table}\n${canon.join("\n")}`);
  }
  return out.join("\n");
}

export async function runRebuild(store: Store, out: Out): Promise<{ events_replayed: number; documents: number; mirrors_repaired: string[]; torn_lines: number }> {
  const db = store.ledger.db;
  out.progress("rebuilding: dropping projections…");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const t of PROJECTION_TABLES) db.exec(`DELETE FROM ${t}`);
    // reset AUTOINCREMENT counters so replay reproduces identical row ids
    db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('metric_history','content_transitions','journal_index')`);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  out.progress("rebuilding: scanning documents (files are canon)…");
  const warnings = await scanDocuments(store);
  for (const w of warnings) out.progress(`  warning: ${w.file}: ${w.problem}`);
  out.progress("rebuilding: replaying events (facts are events)…");
  const { events, truncated } = await readAllEvents(store.company.paths.events);
  store.ledger.transaction(() => {
    for (const e of events) store.ledger.project(e);
  });
  out.progress("rebuilding: repairing machine-owned mirrors…");
  const repaired = await repairMirrors(store);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const docs = (db.prepare("SELECT (SELECT COUNT(*) FROM metrics) + (SELECT COUNT(*) FROM hypotheses) + (SELECT COUNT(*) FROM channels) + (SELECT COUNT(*) FROM playbooks) + (SELECT COUNT(*) FROM contents) AS n").get() as { n: number }).n;
  return { events_replayed: events.length, documents: docs, mirrors_repaired: repaired, torn_lines: truncated.length };
}

export async function rebuildCommand(store: Store, out: Out): Promise<void> {
  const result = await runRebuild(store, out);
  out.ok("rebuild", result, () => {
    out.print(
      `rebuilt: ${result.documents} documents scanned, ${result.events_replayed} events replayed, ${result.mirrors_repaired.length} mirror(s) repaired${result.torn_lines > 0 ? `, ${result.torn_lines} torn event line(s) quarantined` : ""}`,
    );
    out.print("the ledger is derived; meaning lives in your files and journal.");
  });
}
