/**
 * The staging import boundary — where model output meets the deterministic
 * core. Per-artifact validation: strict id regexes, no symlinks, size caps,
 * schema parse, referential checks (metric/channel/provenance must exist),
 * acceptance-matrix check at import (not at push), no overwriting existing
 * ids. Valid artifacts are imported; invalid ones are rejected WITH REASONS;
 * the staging dir is preserved on any rejection for inspection.
 */
import { readdir, readFile, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ContentMetaSchema, HypothesisSchema, schemaProblem } from "../core/schema.js";
import { readFm, containedJoin } from "../core/fm.js";
import { HYP_ID_RE, CONTENT_ID_RE } from "../ids.js";
import type { Store } from "../core/store.js";
import type { Hat } from "./hats.js";

const MAX_ARTIFACT_BYTES = 256 * 1024;

export interface ImportReport {
  imported: Array<{ kind: string; id: string; file: string }>;
  rejected: Array<{ file: string; reason: string }>;
  narration: string | null;
}

async function safeEntry(dir: string, name: string): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  if (name.includes("/") || name.includes("\\") || name.includes("..") || name.startsWith(".")) {
    return { ok: false, reason: "path characters not allowed in staged artifact names" };
  }
  const p = path.join(dir, name);
  const st = await lstat(p);
  if (st.isSymbolicLink()) return { ok: false, reason: "symlinks are never imported" };
  if (st.isFile() && st.size > MAX_ARTIFACT_BYTES) return { ok: false, reason: `file exceeds ${MAX_ARTIFACT_BYTES} bytes` };
  return { ok: true, path: p };
}

export async function importStaging(store: Store, hat: Hat, stagingDir: string): Promise<ImportReport> {
  const report: ImportReport = { imported: [], rejected: [], narration: null };
  if (!existsSync(stagingDir)) return report;
  const entries = (await readdir(stagingDir)).sort();

  for (const name of entries) {
    const safe = await safeEntry(stagingDir, name);
    if (!safe.ok) {
      report.rejected.push({ file: name, reason: safe.reason });
      continue;
    }
    const st = await lstat(safe.path);

    // narration (planner / narrator)
    if (st.isFile() && name === "narration.md" && hat.imports.includes("narration")) {
      report.narration = (await readFile(safe.path, "utf8")).slice(0, 20_000);
      continue;
    }

    // doctrine draft (onboarding) — surfaced, never auto-imported (human diff gate)
    if (st.isFile() && name === "identity.md" && hat.imports.includes("doctrine_draft")) {
      report.imported.push({ kind: "doctrine_draft", id: "identity", file: safe.path });
      continue;
    }

    // hypothesis files
    if (st.isFile() && name.endsWith(".md") && hat.imports.includes("hypothesis")) {
      const id = name.slice(0, -3);
      if (!HYP_ID_RE.test(id)) {
        report.rejected.push({ file: name, reason: `filename must match H-YYYYMMDD-slug.md` });
        continue;
      }
      try {
        const fm = await readFm(safe.path);
        if (fm.data.id !== id) {
          report.rejected.push({ file: name, reason: `frontmatter id "${fm.data.id}" must equal filename id "${id}"` });
          continue;
        }
        const parsed = HypothesisSchema.safeParse({ ...fm.data, state: "proposed", disposition: "open" });
        if (!parsed.success) {
          report.rejected.push({ file: name, reason: schemaProblem(name, parsed.error).problem });
          continue;
        }
        const h = parsed.data;
        const db = store.ledger.db;
        if (db.prepare("SELECT 1 FROM hypotheses WHERE id=?").get(h.id)) {
          report.rejected.push({ file: name, reason: `hypothesis ${h.id} already exists — ids are never overwritten` });
          continue;
        }
        if (!db.prepare("SELECT 1 FROM metrics WHERE name=?").get(h.metric)) {
          report.rejected.push({ file: name, reason: `metric "${h.metric}" does not exist (invariant VI: every bet traces to a real gap)` });
          continue;
        }
        let feasible = true;
        for (const proj of h.experiment.projects) {
          const ch = db.prepare("SELECT acceptance FROM channels WHERE id=?").get(proj.channel) as
            | { acceptance: string }
            | undefined;
          if (!ch) {
            report.rejected.push({ file: name, reason: `project targets unknown channel "${proj.channel}"` });
            feasible = false;
            break;
          }
          const acceptance = JSON.parse(ch.acceptance) as string[];
          if (!acceptance.includes(proj.payload_type)) {
            report.rejected.push({
              file: name,
              reason: `channel "${proj.channel}" does not accept payload type "${proj.payload_type}" (acceptance: ${acceptance.join(", ")}) — feasibility is two lookups at design time`,
            });
            feasible = false;
            break;
          }
        }
        if (!feasible) continue;
        if (h.playbook && !db.prepare("SELECT 1 FROM playbooks WHERE name=?").get(h.playbook)) {
          report.rejected.push({ file: name, reason: `playbook "${h.playbook}" does not exist` });
          continue;
        }
        // Import: canonical copy + registration event; doc row lands via scan-on-write.
        const target = path.join(store.company.paths.hypotheses, name);
        const raw = await readFile(safe.path, "utf8");
        await store.commit(
          [
            store.event("agent:strategist", "artifact_registered", {
              kind: "hypothesis",
              subject: h.id,
              path: target,
            }),
          ],
          [{ kind: "write", file: target, contents: raw }],
          [`strategist registered ${h.id} on ${h.metric}: "${h.claim.summary}"`],
        );
        // register the doc row immediately (same code path as scanner)
        const { scanDocuments } = await import("../core/scan.js");
        await scanDocuments(store);
        report.imported.push({ kind: "hypothesis", id: h.id, file: target });
      } catch (e) {
        report.rejected.push({ file: name, reason: e instanceof Error ? e.message : String(e) });
      }
      continue;
    }

    // content dirs
    if (st.isDirectory() && hat.imports.includes("content")) {
      if (!CONTENT_ID_RE.test(name)) {
        report.rejected.push({ file: name, reason: "content directory must match C-YYYYMMDD-slug" });
        continue;
      }
      try {
        const metaPath = path.join(safe.path, "meta.md");
        if (!existsSync(metaPath)) {
          report.rejected.push({ file: name, reason: "missing meta.md" });
          continue;
        }
        const fm = await readFm(metaPath);
        const parsed = ContentMetaSchema.safeParse({ ...fm.data, state: "draft" });
        if (!parsed.success) {
          report.rejected.push({ file: name, reason: schemaProblem(`${name}/meta.md`, parsed.error).problem });
          continue;
        }
        const c = parsed.data;
        if (c.id !== name) {
          report.rejected.push({ file: name, reason: `meta id "${c.id}" must equal directory name` });
          continue;
        }
        const db = store.ledger.db;
        if (db.prepare("SELECT 1 FROM contents WHERE id=?").get(c.id)) {
          report.rejected.push({ file: name, reason: `content ${c.id} already exists` });
          continue;
        }
        const task = db.prepare("SELECT id, project FROM tasks WHERE id=?").get(c.provenance.task) as
          | { id: number; project: number }
          | undefined;
        if (!task || task.project !== c.provenance.project) {
          report.rejected.push({ file: name, reason: `provenance task/project do not exist (invariant VI: no orphans)` });
          continue;
        }
        const proj = db.prepare("SELECT hypothesis FROM projects WHERE id=?").get(c.provenance.project) as
          | { hypothesis: string }
          | undefined;
        if (!proj || proj.hypothesis !== c.provenance.hypothesis) {
          report.rejected.push({ file: name, reason: "provenance hypothesis does not match the project" });
          continue;
        }
        const ch = db.prepare("SELECT acceptance FROM channels WHERE id=?").get(c.channel) as
          | { acceptance: string }
          | undefined;
        if (!ch || !(JSON.parse(ch.acceptance) as string[]).includes(c.payload_type)) {
          report.rejected.push({ file: name, reason: `channel "${c.channel}" missing or does not accept "${c.payload_type}"` });
          continue;
        }
        // schema already pins payload_file to a bare filename; re-assert containment
        // at both the staging read and the canon write (defense in depth).
        const payloadStaged = containedJoin(safe.path, c.payload_file);
        const targetDir = path.join(store.company.paths.content, name);
        const payloadTarget = containedJoin(targetDir, c.payload_file);
        if (!payloadStaged || !payloadTarget) {
          report.rejected.push({ file: name, reason: `payload_file "${c.payload_file}" escapes the content directory` });
          continue;
        }
        const pst = await lstat(payloadStaged).catch(() => null);
        if (!pst || pst.isSymbolicLink() || !pst.isFile() || pst.size > MAX_ARTIFACT_BYTES) {
          report.rejected.push({ file: name, reason: `payload_file "${c.payload_file}" missing, oversized, or not a regular file` });
          continue;
        }
        const metaRaw = await readFile(metaPath, "utf8");
        const payloadRaw = await readFile(payloadStaged, "utf8");
        await store.commit(
          [store.event("agent:builder", "artifact_registered", { kind: "content", subject: c.id, path: targetDir })],
          [
            { kind: "write", file: path.join(targetDir, "meta.md"), contents: metaRaw },
            { kind: "write", file: payloadTarget, contents: payloadRaw },
          ],
          [`content builder drafted ${c.id} for ${c.channel} (hypothesis ${c.provenance.hypothesis})`],
        );
        const { scanDocuments } = await import("../core/scan.js");
        await scanDocuments(store);
        report.imported.push({ kind: "content", id: c.id, file: targetDir });
      } catch (e) {
        report.rejected.push({ file: name, reason: e instanceof Error ? e.message : String(e) });
      }
      continue;
    }

    // anything else this hat may not produce
    if (name !== "notes.md") {
      report.rejected.push({ file: name, reason: `hat "${hat.name}" may not produce this artifact type` });
    }
  }
  return report;
}
