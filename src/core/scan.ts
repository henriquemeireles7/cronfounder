/**
 * Document scanner — where "files are canon" becomes mechanical.
 *
 * For every document type it: validates the file, imports HUMAN-owned fields
 * into the ledger's document rows (files win), detects human edits via field
 * hashes (journaled as human_edit events), and — in repairMirrors — rewrites
 * MACHINE-owned mirror fields from the ledger when they drift (the ledger
 * wins; a hand-edited status is detectably overwritten, invariant I).
 */
import { readdir, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  ChannelSetupSchema,
  ContentMetaSchema,
  HypothesisSchema,
  MetricSchema,
  PlaybookSchema,
  CHANNEL_MACHINE_FIELDS,
  CONTENT_MACHINE_FIELDS,
  HYPOTHESIS_MACHINE_FIELDS,
  METRIC_MACHINE_FIELDS,
  PLAYBOOK_MACHINE_FIELDS,
} from "./schema.js";
import { readFm } from "./fm.js";
import { hashFields } from "./hash.js";
import type { Store } from "./store.js";
import type { CfEvent } from "./events.js";

export interface ScanWarning {
  file: string;
  problem: string;
}

async function listFiles(dir: string, suffix = ".md"): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  const out: string[] = [];
  for (const n of names.sort()) {
    if (!n.endsWith(suffix) || n.startsWith(".")) continue;
    const p = path.join(dir, n);
    const st = await lstat(p);
    if (st.isSymbolicLink() || !st.isFile()) continue; // symlinks are never scanned
    out.push(p);
  }
  return out;
}

async function listChannelSetups(channelsDir: string): Promise<string[]> {
  if (!existsSync(channelsDir)) return [];
  const out: string[] = [];
  for (const n of (await readdir(channelsDir)).sort()) {
    const setup = path.join(channelsDir, n, "setup.md");
    if (existsSync(setup)) out.push(setup);
  }
  return out;
}

async function listContentMetas(contentDir: string): Promise<string[]> {
  if (!existsSync(contentDir)) return [];
  const out: string[] = [];
  for (const n of (await readdir(contentDir)).sort()) {
    const meta = path.join(contentDir, n, "meta.md");
    if (existsSync(meta)) out.push(meta);
  }
  return out;
}

/** Import/refresh document rows from files. Returns warnings for invalid files. */
export async function scanDocuments(store: Store): Promise<ScanWarning[]> {
  const warnings: ScanWarning[] = [];
  const events: CfEvent[] = [];
  const db = store.ledger.db;
  const p = store.company.paths;

  // ---- metrics
  for (const file of await listFiles(p.metrics)) {
    try {
      const fm = await readFm(file);
      const parsed = MetricSchema.safeParse(fm.data);
      if (!parsed.success) {
        warnings.push({ file, problem: parsed.error.issues[0]?.message ?? "invalid" });
        continue;
      }
      const m = parsed.data;
      const humanHash = hashFields(fm.data, METRIC_MACHINE_FIELDS);
      const existing = db.prepare("SELECT human_hash FROM metrics WHERE name=?").get(m.name) as
        | { human_hash: string }
        | undefined;
      if (!existing) {
        db.prepare(
          `INSERT INTO metrics (name, parent, unit, direction, sensor_type, sensor_json, target, deadline, spec_set_by, spec_set_at, baseline_value, file_path, human_hash)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          m.name,
          m.parent,
          m.unit,
          m.direction,
          m.sensor.type,
          JSON.stringify(m.sensor),
          m.spec?.target ?? null,
          m.spec?.deadline ?? null,
          m.spec?.set_by ?? null,
          m.spec?.set_at ?? null,
          m.spec?.baseline_value ?? null,
          file,
          humanHash,
        );
      } else if (existing.human_hash !== humanHash) {
        db.prepare(
          `UPDATE metrics SET parent=?, unit=?, direction=?, sensor_type=?, sensor_json=?, target=?, deadline=?, spec_set_by=?, spec_set_at=?, baseline_value=?, file_path=?, human_hash=? WHERE name=?`,
        ).run(
          m.parent,
          m.unit,
          m.direction,
          m.sensor.type,
          JSON.stringify(m.sensor),
          m.spec?.target ?? null,
          m.spec?.deadline ?? null,
          m.spec?.set_by ?? null,
          m.spec?.set_at ?? null,
          m.spec?.baseline_value ?? null,
          file,
          humanHash,
          m.name,
        );
        events.push(store.event("human", "human_edit", { path: file, fields: ["(human-owned metric fields)"] }));
      }
    } catch (e) {
      warnings.push({ file, problem: e instanceof Error ? e.message : String(e) });
    }
  }

  // ---- hypotheses
  for (const file of await listFiles(p.hypotheses)) {
    try {
      const fm = await readFm(file);
      const parsed = HypothesisSchema.safeParse(fm.data);
      if (!parsed.success) {
        warnings.push({ file, problem: parsed.error.issues[0]?.message ?? "invalid" });
        continue;
      }
      const h = parsed.data;
      const humanHash = hashFields(fm.data, HYPOTHESIS_MACHINE_FIELDS);
      const existing = db.prepare("SELECT human_hash FROM hypotheses WHERE id=?").get(h.id) as
        | { human_hash: string }
        | undefined;
      const humanCols = {
        metric: h.metric,
        playbook: h.playbook,
        claim_summary: h.claim.summary,
        target_delta: h.claim.target_delta,
        unit: h.claim.unit,
        cost_tokens: h.economics.cost_tokens,
        cost_human_min: h.economics.cost_human_min,
        risk: h.economics.risk,
        confidence: h.economics.confidence,
        confidence_source: h.economics.confidence_source,
        duration_days: h.experiment.duration_days,
        min_delta: h.kill_criteria.min_delta,
        tripwires_json: JSON.stringify(h.kill_criteria.tripwires),
        projects_json: JSON.stringify(h.experiment.projects),
        channels_json: JSON.stringify(h.experiment.channels),
      };
      if (!existing) {
        db.prepare(
          `INSERT INTO hypotheses (id, metric, playbook, claim_summary, target_delta, unit, cost_tokens, cost_human_min, risk, confidence, confidence_source, duration_days, min_delta, tripwires_json, projects_json, channels_json, file_path, human_hash)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          h.id,
          humanCols.metric,
          humanCols.playbook,
          humanCols.claim_summary,
          humanCols.target_delta,
          humanCols.unit,
          humanCols.cost_tokens,
          humanCols.cost_human_min,
          humanCols.risk,
          humanCols.confidence,
          humanCols.confidence_source,
          humanCols.duration_days,
          humanCols.min_delta,
          humanCols.tripwires_json,
          humanCols.projects_json,
          humanCols.channels_json,
          file,
          humanHash,
        );
      } else if (existing.human_hash !== humanHash) {
        db.prepare(
          `UPDATE hypotheses SET metric=?, playbook=?, claim_summary=?, target_delta=?, unit=?, cost_tokens=?, cost_human_min=?, risk=?, confidence=?, confidence_source=?, duration_days=?, min_delta=?, tripwires_json=?, projects_json=?, channels_json=?, file_path=?, human_hash=? WHERE id=?`,
        ).run(
          humanCols.metric,
          humanCols.playbook,
          humanCols.claim_summary,
          humanCols.target_delta,
          humanCols.unit,
          humanCols.cost_tokens,
          humanCols.cost_human_min,
          humanCols.risk,
          humanCols.confidence,
          humanCols.confidence_source,
          humanCols.duration_days,
          humanCols.min_delta,
          humanCols.tripwires_json,
          humanCols.projects_json,
          humanCols.channels_json,
          file,
          humanHash,
          h.id,
        );
        events.push(store.event("human", "human_edit", { path: file, fields: ["(human-owned hypothesis fields)"] }));
      }
    } catch (e) {
      warnings.push({ file, problem: e instanceof Error ? e.message : String(e) });
    }
  }

  // ---- channels
  for (const file of await listChannelSetups(p.channels)) {
    try {
      const fm = await readFm(file);
      const parsed = ChannelSetupSchema.safeParse(fm.data);
      if (!parsed.success) {
        warnings.push({ file, problem: parsed.error.issues[0]?.message ?? "invalid" });
        continue;
      }
      const c = parsed.data;
      const humanHash = hashFields(fm.data, CHANNEL_MACHINE_FIELDS);
      db.prepare(
        `INSERT INTO channels (id, kind, acceptance, capabilities, cadence_max_per_day, credential_ref, driver_ref, file_path, human_hash)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, acceptance=excluded.acceptance, capabilities=excluded.capabilities,
           cadence_max_per_day=excluded.cadence_max_per_day, credential_ref=excluded.credential_ref,
           driver_ref=excluded.driver_ref, file_path=excluded.file_path, human_hash=excluded.human_hash`,
      ).run(
        c.id,
        c.kind,
        JSON.stringify(c.acceptance),
        JSON.stringify(c.capabilities),
        c.cadence.max_per_day,
        c.credential_ref,
        c.driver_ref,
        file,
        humanHash,
      );
    } catch (e) {
      warnings.push({ file, problem: e instanceof Error ? e.message : String(e) });
    }
  }

  // ---- playbooks
  for (const file of await listFiles(p.playbooks)) {
    try {
      const fm = await readFm(file);
      const parsed = PlaybookSchema.safeParse(fm.data);
      if (!parsed.success) {
        warnings.push({ file, problem: parsed.error.issues[0]?.message ?? "invalid" });
        continue;
      }
      const pb = parsed.data;
      const humanHash = hashFields(fm.data, PLAYBOOK_MACHINE_FIELDS);
      db.prepare(
        `INSERT INTO playbooks (name, autonomy, file_path, human_hash) VALUES (?,?,?,?)
         ON CONFLICT(name) DO UPDATE SET autonomy=excluded.autonomy, file_path=excluded.file_path, human_hash=excluded.human_hash`,
      ).run(pb.name, pb.autonomy, file, humanHash);
    } catch (e) {
      warnings.push({ file, problem: e instanceof Error ? e.message : String(e) });
    }
  }

  // ---- content
  for (const file of await listContentMetas(p.content)) {
    try {
      const fm = await readFm(file);
      const parsed = ContentMetaSchema.safeParse(fm.data);
      if (!parsed.success) {
        warnings.push({ file, problem: parsed.error.issues[0]?.message ?? "invalid" });
        continue;
      }
      const c = parsed.data;
      const humanHash = hashFields(fm.data, CONTENT_MACHINE_FIELDS);
      db.prepare(
        `INSERT INTO contents (id, channel, payload_type, payload_file, task, project, hypothesis, metric, file_path, human_hash)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET channel=excluded.channel, payload_type=excluded.payload_type, payload_file=excluded.payload_file,
           task=excluded.task, project=excluded.project, hypothesis=excluded.hypothesis, metric=excluded.metric,
           file_path=excluded.file_path, human_hash=excluded.human_hash`,
      ).run(c.id, c.channel, c.payload_type, c.payload_file, c.provenance.task, c.provenance.project, c.provenance.hypothesis, c.provenance.metric, file, humanHash);
    } catch (e) {
      warnings.push({ file, problem: e instanceof Error ? e.message : String(e) });
    }
  }

  if (events.length > 0) await store.append(events);
  return warnings;
}

/**
 * Repair machine-owned frontmatter mirrors from the ledger. The ledger wins
 * for these fields — this is how a hand-edited `status` is "detectably
 * overwritten next run" (M1 DoD) without a sensor call.
 */
export async function repairMirrors(store: Store): Promise<string[]> {
  const db = store.ledger.db;
  const repaired: string[] = [];

  const metrics = db
    .prepare("SELECT name, file_path, status_value, status_measured_at, sensor_type FROM metrics")
    .all() as Array<{ name: string; file_path: string; status_value: number | null; status_measured_at: string | null; sensor_type: string }>;
  for (const m of metrics) {
    try {
      const fm = await readFm(m.file_path);
      const fileStatus = fm.data.status as { value?: number; measured_at?: string } | null | undefined;
      const drifted =
        (m.status_value === null && fileStatus != null) ||
        (m.status_value !== null && (fileStatus == null || fileStatus.value !== m.status_value || fileStatus.measured_at !== m.status_measured_at));
      if (drifted) {
        const { patchFm } = await import("./fm.js");
        await patchFm(m.file_path, {
          status:
            m.status_value === null
              ? null
              : { value: m.status_value, measured_at: m.status_measured_at, written_by: `sensor:${m.sensor_type}` },
        });
        repaired.push(`${m.file_path} (status)`);
      }
    } catch {
      /* file gone or invalid — scanDocuments already warned */
    }
  }

  const hyps = db
    .prepare("SELECT id, file_path, state, disposition, review_at, activated_at FROM hypotheses")
    .all() as Array<{ id: string; file_path: string; state: string; disposition: string; review_at: string | null; activated_at: string | null }>;
  for (const h of hyps) {
    try {
      const fm = await readFm(h.file_path);
      if (fm.data.state !== h.state || fm.data.disposition !== h.disposition) {
        const { patchFm } = await import("./fm.js");
        await patchFm(h.file_path, {
          state: h.state,
          disposition: h.disposition,
          review_at: h.review_at,
          activated_at: h.activated_at,
        });
        repaired.push(`${h.file_path} (state)`);
      }
    } catch {
      /* skip */
    }
  }

  const contents = db.prepare("SELECT id, file_path, state FROM contents").all() as Array<{
    id: string;
    file_path: string;
    state: string;
  }>;
  for (const c of contents) {
    try {
      const fm = await readFm(c.file_path);
      if (fm.data.state !== c.state) {
        const { patchFm } = await import("./fm.js");
        await patchFm(c.file_path, { state: c.state });
        repaired.push(`${c.file_path} (state)`);
      }
    } catch {
      /* skip */
    }
  }

  return repaired;
}
