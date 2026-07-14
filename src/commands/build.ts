/**
 * build — run the bound builder for each open project. Tasks claim under the
 * company lock; claims left by a dead run are reset at the start of the next
 * build (the lock guarantees one build at a time — no lease math needed).
 * Every draft lands at pending_approval with an approve_content card
 * (invariant III: drafts stop at the gate).
 */
import { CronfounderError, EXIT } from "../errors.js";
import type { Store } from "../core/store.js";
import type { Out } from "../output.js";
import { compactDate, slugify } from "../ids.js";
import { assertHypothesisTransition, assertTaskTransition } from "../core/states.js";
import { fileRequest } from "../core/inbox.js";
import { selectAdapter, prepareRun, runtimeMissingError, type RunBundle } from "../runtime/adapter.js";
import { HATS } from "../runtime/hats.js";
import { contentBuilderPrompt } from "../runtime/prompts.js";
import { importStaging } from "../runtime/staging.js";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface TaskRow {
  id: number;
  project: number;
  kind: string;
  brief: string;
  state: string;
  claimed_by: string | null;
}
interface ProjectRow {
  id: number;
  hypothesis: string;
  type: string;
  channel: string;
  payload_type: string;
  builder: string;
  brief: string;
  state: string;
}

export interface BuildResult {
  drafted: string[];
  cards: number[];
  dry_runs: RunBundle[];
  nothing_due: boolean;
}

export async function runBuild(store: Store, out: Out, opts: { runtime?: string; dryRun?: boolean }): Promise<BuildResult> {
  const db = store.ledger.db;
  const result: BuildResult = { drafted: [], cards: [], dry_runs: [], nothing_due: false };

  // reset claims left by a dead run — we hold the exclusive lock, so any
  // 'claimed' task right now is an orphan
  const orphans = db.prepare("SELECT id, project FROM tasks WHERE state='claimed'").all() as Array<{ id: number; project: number }>;
  for (const t of orphans) {
    assertTaskTransition(`T-${t.id}`, "claimed", "todo", "core");
    await store.append([
      store.event("core", "task_event", { task: t.id, project: t.project, from: "claimed", to: "todo" }),
    ]);
    out.progress(`reset orphaned claim on T-${t.id} (previous run died)`);
  }

  const tasks = db
    .prepare(
      `SELECT t.id, t.project, t.kind, t.brief, t.state, t.claimed_by FROM tasks t
       JOIN projects p ON p.id = t.project
       JOIN hypotheses h ON h.id = p.hypothesis
       WHERE t.state='todo' AND p.state='open' AND h.state IN ('active') AND h.disposition='open'
       ORDER BY t.id`,
    )
    .all() as unknown as TaskRow[];
  if (tasks.length === 0) {
    result.nothing_due = true;
    return result;
  }

  for (const task of tasks) {
    const project = db.prepare("SELECT * FROM projects WHERE id=?").get(task.project) as unknown as ProjectRow;
    const hyp = db.prepare("SELECT id, metric, claim_summary FROM hypotheses WHERE id=?").get(project.hypothesis) as {
      id: string;
      metric: string;
      claim_summary: string;
    };

    if (project.type === "channel_setup") {
      // channel setup is human work by definition (invariant IV) — the card IS the deliverable
      const existing = db.prepare("SELECT 1 FROM inbox WHERE state='open' AND kind='setup_channel' AND blocking_id=?").get(project.channel);
      if (!existing) {
        const { setupChannelSteps } = await import("../core/inbox.js");
        const chRow = db.prepare("SELECT driver_ref FROM channels WHERE id=?").get(project.channel) as { driver_ref: string | null } | undefined;
        const card = await fileRequest(
          store,
          "agent:channel_builder",
          "setup_channel",
          {
            what: `set up channel "${project.channel}"`,
            why: `project P-${project.id} of ${hyp.id} → metric ${hyp.metric}`,
            steps: setupChannelSteps(project.channel, chRow?.driver_ref ?? null),
            blocking: `${hyp.id}`,
            channel: project.channel,
          },
          { blockingKind: "channel", blockingId: project.channel },
        );
        result.cards.push(card);
      }
      await store.append([
        store.event("core", "task_event", { task: task.id, project: task.project, from: "todo", to: "done" }),
        store.event("core", "state_transition", { kind: "project", subject: project.id, from: "open", to: "done", actor: "core" }),
      ]);
      continue;
    }

    // content project
    const count = Number(/count: (\d+)/.exec(task.brief)?.[1] ?? 1);
    const hat = HATS.content_builder;
    const ctx = {
      project: project.id,
      task: task.id,
      hypothesis: hyp.id,
      metric: hyp.metric,
      channel: project.channel,
      payload_type: project.payload_type,
      count,
      brief: project.brief,
      slug: slugify(project.brief).slice(0, 24) || "draft",
      id_date: compactDate(),
    };
    const bundle = await prepareRun(store.company, hat, "", [`C-${ctx.id_date}-${ctx.slug}-<i>/ (meta.md + payload)`]);
    const prompt = await contentBuilderPrompt(store.company, ctx, bundle.staging_dir);
    await writeFile(bundle.prompt_file, prompt, "utf8");
    await writeFile(
      path.join(bundle.run_dir, "context.json"),
      JSON.stringify({ command: "build", task: task.id, project: project.id }, null, 2),
      "utf8",
    );

    if (opts.dryRun) {
      result.dry_runs.push(bundle);
      continue;
    }
    const adapter = selectAdapter(store.company, opts.runtime);
    if (!adapter) throw runtimeMissingError("build");

    assertTaskTransition(`T-${task.id}`, "todo", "claimed", "core");
    await store.append([
      store.event("core", "task_event", { task: task.id, project: task.project, from: "todo", to: "claimed", claimed_by: bundle.run_id }),
    ]);
    out.progress(`content builder (${adapter.name}) drafting for ${project.channel} (task T-${task.id})…`);
    try {
      await adapter.invoke(bundle, prompt, store.company.config.runtime.timeout_s);
      const finished = await finishBuildTask(store, out, task.id, bundle.staging_dir);
      result.drafted.push(...finished.drafted);
      result.cards.push(...finished.cards);
    } catch (e) {
      await store.append([
        store.event("core", "task_event", { task: task.id, project: task.project, from: "claimed", to: "todo" }),
      ]);
      throw e;
    }
  }
  return result;
}

/** Import staged drafts for a task, gate them, close the task/project. Shared with `run import`. */
export async function finishBuildTask(
  store: Store,
  out: Out,
  taskId: number,
  stagingDir: string,
): Promise<{ drafted: string[]; cards: number[] }> {
  const db = store.ledger.db;
  const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(taskId) as unknown as TaskRow | undefined;
  if (!task) {
    throw new CronfounderError({
      code: "E_NOT_FOUND",
      exit: EXIT.VALIDATION,
      problem: `task T-${taskId} does not exist`,
      cause: "wrong run bundle or stale context",
      fix: "cronfounder board --json shows live work",
    });
  }
  if (task.state === "todo") {
    await store.append([
      store.event("core", "task_event", { task: task.id, project: task.project, from: "todo", to: "claimed", claimed_by: "import" }),
    ]);
  }
  const hat = HATS.content_builder;
  const report = await importStaging(store, hat, stagingDir);
  for (const r of report.rejected) out.progress(`rejected ${r.file}: ${r.reason}`);
  const drafted: string[] = [];
  const cards: number[] = [];
  for (const item of report.imported.filter((i) => i.kind === "content")) {
    const c = db.prepare("SELECT * FROM contents WHERE id=?").get(item.id) as any;
    // draft → pending_approval + card (the gate)
    await store.commit(
      [store.event("core", "state_transition", { kind: "content", subject: item.id, from: "draft", to: "pending_approval", actor: "core" })],
      [{ kind: "patch", file: path.join(item.file, "meta.md"), patches: { state: "pending_approval" } }],
      [`${item.id} → pending_approval (nothing side-effectful skips the gate)`],
    );
    let preview = "";
    try {
      preview = (await readFile(path.join(item.file, c.payload_file), "utf8")).slice(0, 500);
    } catch {
      preview = "(payload unreadable)";
    }
    const card = await fileRequest(
      store,
      "agent:content_builder",
      "approve_content",
      {
        what: `release ${item.id} to channel "${c.channel}"`,
        why: `provenance: ${item.id} → T-${c.task} → P-${c.project} → ${c.hypothesis} → ${c.metric} (no orphans, invariant VI)`,
        steps: [],
        blocking: `publication of ${item.id}`,
        context: preview,
        content: item.id,
        channel: c.channel,
      },
      { blockingKind: "content", blockingId: item.id },
    );
    cards.push(card);
    drafted.push(item.id);
  }

  if (report.imported.some((i) => i.kind === "content")) {
    await store.append([
      store.event("core", "task_event", { task: task.id, project: task.project, from: "claimed", to: "done" }),
    ]);
    const remaining = db.prepare("SELECT COUNT(*) c FROM tasks WHERE project=? AND state NOT IN ('done','abandoned')").get(task.project) as {
      c: number;
    };
    if (remaining.c === 0) {
      await store.append([
        store.event("core", "state_transition", { kind: "project", subject: task.project, from: "open", to: "done", actor: "core" }),
      ]);
      const project = db.prepare("SELECT hypothesis FROM projects WHERE id=?").get(task.project) as { hypothesis: string };
      const openProjects = db
        .prepare("SELECT COUNT(*) c FROM projects WHERE hypothesis=? AND state='open'")
        .get(project.hypothesis) as { c: number };
      if (openProjects.c === 0) {
        const h = db.prepare("SELECT id, state, file_path FROM hypotheses WHERE id=?").get(project.hypothesis) as any;
        if (h && h.state === "active") {
          assertHypothesisTransition(h.id, "active", "measuring", "core");
          await store.commit(
            [store.event("core", "state_transition", { kind: "hypothesis", subject: h.id, from: "active", to: "measuring", actor: "core" })],
            [{ kind: "patch", file: h.file_path, patches: { state: "measuring" } }],
            [`${h.id} → measuring: all projects done; the sensors take it from here`],
          );
        }
      }
    }
  } else {
    // builder produced nothing importable — release the claim, keep the work
    await store.append([
      store.event("core", "task_event", { task: task.id, project: task.project, from: "claimed", to: "todo" }),
    ]);
  }
  return { drafted, cards };
}

export async function buildCommand(store: Store, out: Out, opts: { runtime?: string; dryRun?: boolean }): Promise<void> {
  const result = await runBuild(store, out, opts);
  if (result.nothing_due) {
    out.noop("build", "no open tasks — fund a bet first (cronfounder inbox) or check the board");
  }
  out.ok("build", result, () => {
    if (result.dry_runs.length > 0) {
      out.print(`dry run(s) prepared — do the builder's work yourself:`);
      for (const b of result.dry_runs) {
        out.print(`  prompt: ${b.prompt_file}`);
        out.print(`  write drafts into: ${b.staging_dir}`);
        out.print(`  then: cronfounder run import ${b.run_id}`);
      }
      return;
    }
    out.print(`drafted: ${result.drafted.join(", ") || "nothing"}`);
    if (result.cards.length > 0) {
      out.print(`${result.cards.length} approval card(s) filed — release drafts: cronfounder inbox`);
    }
  });
}
