/**
 * resolve <R-id> — the human gate, able to say every kind of no.
 *   --approve            fund the recommended bet / release content
 *   --choice <key>       fund a specific bet / answer a decide card
 *   --reject [--reason]  refuse (content → draft; bet set → rejected disposition)
 *   --done               a setup/credential card's steps are complete (core re-probes)
 *   --as <actor>         attribution for delegated approval (agent operating for a principal)
 * `approve <R-id>` is the spec-fidelity alias for `resolve <R-id> --approve`.
 */
import path from "node:path";
import { CronfounderError, EXIT } from "../errors.js";
import { activateHypothesis } from "../core/activate.js";
import { assertContentTransition, assertHypothesisTransition } from "../core/states.js";
import { channelReadiness } from "../core/readiness.js";
import { fileRequest } from "../core/inbox.js";
import type { Store } from "../core/store.js";
import type { Out } from "../output.js";
import type { CfEvent } from "../core/events.js";
import type { FileOp } from "../core/store.js";
import { iso, now } from "../ids.js";

export interface ResolveOpts {
  approve?: boolean;
  reject?: boolean;
  done?: boolean;
  choice?: string;
  reason?: string;
  as?: string;
}

function parseRequestId(raw: string): number {
  const m = /^R-(\d+)$/.exec(raw.trim());
  if (!m) {
    if (/^H-/.test(raw)) {
      throw new CronfounderError({
        code: "E_WRONG_ID_KIND",
        exit: EXIT.VALIDATION,
        problem: `"${raw}" is a hypothesis id, but resolve takes a request id (R-…)`,
        cause: "bets are funded through their funding card, so every approval is auditable",
        fix: `find the card blocking this hypothesis: cronfounder inbox   (then: cronfounder resolve R-<n> --choice ${raw})`,
      });
    }
    if (/^C-/.test(raw)) {
      throw new CronfounderError({
        code: "E_WRONG_ID_KIND",
        exit: EXIT.VALIDATION,
        problem: `"${raw}" is a content id, but resolve takes a request id (R-…)`,
        cause: "content is released through its approve_content card",
        fix: "find it: cronfounder inbox",
      });
    }
    throw new CronfounderError({
      code: "E_BAD_ID",
      exit: EXIT.VALIDATION,
      problem: `"${raw}" is not a request id`,
      cause: "request ids look like R-12",
      fix: "list open requests: cronfounder inbox",
    });
  }
  return Number(m[1]);
}

export async function resolveCommand(store: Store, out: Out, rawId: string, opts: ResolveOpts): Promise<void> {
  const id = parseRequestId(rawId);
  const db = store.ledger.db;
  const card = db.prepare("SELECT * FROM inbox WHERE id=?").get(id) as any;
  if (!card) {
    throw new CronfounderError({
      code: "E_NOT_FOUND",
      exit: EXIT.VALIDATION,
      problem: `request R-${id} does not exist`,
      cause: "wrong id, or the ledger is stale",
      fix: "list open requests: cronfounder inbox   (or repair: cronfounder rebuild)",
    });
  }
  if (card.state !== "open") {
    throw new CronfounderError({
      code: "E_ALREADY_RESOLVED",
      exit: EXIT.VALIDATION,
      problem: `request R-${id} was already resolved (${card.resolution ?? "done"} at ${card.resolved_at})`,
      cause: "cards resolve exactly once — the journal remembers",
      fix: "nothing to do; see: cronfounder inbox",
    });
  }
  const actor = opts.as ?? "human";
  const payload = JSON.parse(card.payload) as Record<string, any>;
  const modes = [opts.approve, opts.reject, opts.done, opts.choice !== undefined].filter(Boolean).length;
  if (modes !== 1) {
    throw new CronfounderError({
      code: "E_RESOLVE_MODE",
      exit: EXIT.VALIDATION,
      problem: "resolve needs exactly one of: --approve, --reject, --done, --choice <key>",
      cause: "the resolution must be unambiguous — it becomes a permanent journal fact",
      fix: `for this ${card.kind} card: ${hintFor(card.kind, id)}`,
    });
  }

  switch (card.kind as string) {
    case "approve_hypothesis":
      await resolveFunding(store, out, id, payload, opts, actor);
      break;
    case "approve_content":
      await resolveContent(store, out, id, payload, opts, actor);
      break;
    case "setup_channel":
    case "provide_credential":
      await resolveSetup(store, out, id, card.kind, payload, opts, actor);
      break;
    case "decide":
      await resolveDecide(store, out, id, payload, opts, actor);
      break;
    default:
      throw new CronfounderError({
        code: "E_UNKNOWN_KIND",
        exit: EXIT.ERROR,
        problem: `request R-${id} has unknown kind "${card.kind}"`,
        cause: "a newer cronfounder may have filed it",
        fix: "upgrade cronfounder",
      });
  }
}

function hintFor(kind: string, id: number): string {
  switch (kind) {
    case "approve_hypothesis":
      return `cronfounder resolve R-${id} --approve | --choice <H-id> | --reject --reason "..."`;
    case "approve_content":
      return `cronfounder resolve R-${id} --approve | --reject --reason "..."`;
    case "decide":
      return `cronfounder resolve R-${id} --choice <key>`;
    default:
      return `cronfounder resolve R-${id} --done`;
  }
}

async function closeCard(store: Store, id: number, resolution: string, actor: string, extraEvents: CfEvent[] = [], extraOps: FileOp[] = [], prose: string[] = []): Promise<void> {
  const events: CfEvent[] = [
    store.event(actor, "inbox_resolved", { request: id, resolution }),
    ...extraEvents,
  ];
  const cardFile = path.join(store.company.paths.inbox, `R-${id}.md`);
  const ops: FileOp[] = [...extraOps];
  try {
    ops.push({ kind: "patch", file: cardFile, patches: { state: "done", resolution, resolved_at: iso() } });
  } catch {
    /* card mirror missing is fine */
  }
  await store.commit(events, ops, [`${actor} resolved R-${id}: ${resolution}`, ...prose]);
}

async function resolveFunding(store: Store, out: Out, id: number, payload: Record<string, any>, opts: ResolveOpts, actor: string): Promise<void> {
  const db = store.ledger.db;
  const choices = (payload.choices ?? []) as Array<{ key: string }>;
  if (opts.done) {
    throw new CronfounderError({
      code: "E_RESOLVE_MODE",
      exit: EXIT.VALIDATION,
      problem: "--done does not apply to a funding card",
      cause: "funding is approve / choice / reject",
      fix: hintFor("approve_hypothesis", id),
    });
  }
  if (opts.reject) {
    const events: CfEvent[] = [];
    const ops: FileOp[] = [];
    for (const c of choices) {
      const h = db.prepare("SELECT file_path, state FROM hypotheses WHERE id=?").get(c.key) as { file_path: string; state: string } | undefined;
      if (!h) continue;
      events.push(
        store.event(actor, "disposition_change", { kind: "hypothesis", subject: c.key, disposition: "rejected", reason: opts.reason ?? "rejected at the gate" }),
      );
      ops.push({ kind: "patch", file: h.file_path, patches: { disposition: "rejected" } });
    }
    await closeCard(store, id, `rejected${opts.reason ? `: ${opts.reason}` : ""}`, actor, events, ops, [
      `gate refused the ${payload.metric} bet set${opts.reason ? ` — ${opts.reason}` : ""} (refusals are knowledge too)`,
    ]);
    out.ok("resolve", { request: `R-${id}`, resolution: "rejected", bets: choices.map((c) => c.key) }, () => {
      out.print(`rejected ${choices.length} bet(s) on ${payload.metric}. The strategist may propose fresh ones: cronfounder strategize ${payload.metric}`);
    });
  }
  const chosen = opts.choice ?? (payload.hypothesis as string | undefined) ?? choices[0]?.key;
  if (!chosen || !choices.some((c) => c.key === chosen)) {
    throw new CronfounderError({
      code: "E_BAD_CHOICE",
      exit: EXIT.VALIDATION,
      problem: `"${chosen}" is not one of this card's choices`,
      cause: `valid choices: ${choices.map((c) => c.key).join(", ")}`,
      fix: hintFor("approve_hypothesis", id),
    });
  }
  const result = await activateHypothesis(store, chosen, actor === "human" ? "human" : "human", actor);
  // siblings are closed in the same decision — attribution before ambition
  const events: CfEvent[] = [];
  const ops: FileOp[] = [];
  for (const c of choices) {
    if (c.key === chosen) continue;
    const h = db.prepare("SELECT file_path FROM hypotheses WHERE id=?").get(c.key) as { file_path: string } | undefined;
    if (!h) continue;
    events.push(store.event(actor, "disposition_change", { kind: "hypothesis", subject: c.key, disposition: "rejected", reason: `sibling of funded ${chosen}` }));
    ops.push({ kind: "patch", file: h.file_path, patches: { disposition: "rejected" } });
  }
  await closeCard(store, id, `funded ${chosen}`, actor, events, ops, [
    `${actor} funded ${chosen}; siblings closed; ${result.projects.length} project(s) compiled — building next`,
  ]);
  out.ok("resolve", { request: `R-${id}`, funded: chosen, review_at: result.review_at, projects: result.projects, tasks: result.tasks }, () => {
    out.print(`funded ${chosen} — approval is ignition:`);
    out.print(`  ${result.projects.length} project(s), ${result.tasks.length} task(s) compiled`);
    out.print(`  verdict due ${result.review_at} (sensors decide, not the believers)`);
    out.print(`\nnext: cronfounder build   (drafts will arrive as approve_content cards, ~minutes with a runtime)`);
  });
}

async function resolveContent(store: Store, out: Out, id: number, payload: Record<string, any>, opts: ResolveOpts, actor: string): Promise<void> {
  const db = store.ledger.db;
  const contentId = payload.content as string;
  const c = db.prepare("SELECT id, state, file_path FROM contents WHERE id=?").get(contentId) as
    | { id: string; state: string; file_path: string }
    | undefined;
  if (!c) {
    throw new CronfounderError({
      code: "E_NOT_FOUND",
      exit: EXIT.ERROR,
      problem: `content ${contentId} referenced by R-${id} no longer exists`,
      cause: "the content directory was deleted by hand",
      fix: "reject this card (--reject) and rebuild: cronfounder rebuild",
    });
  }
  if (opts.done || opts.choice) {
    throw new CronfounderError({
      code: "E_RESOLVE_MODE",
      exit: EXIT.VALIDATION,
      problem: "content cards resolve with --approve or --reject",
      cause: "the content gate is binary",
      fix: hintFor("approve_content", id),
    });
  }
  if (opts.reject) {
    assertContentTransition(c.id, c.state as any, "draft", "human");
    await closeCard(
      store,
      id,
      `rejected${opts.reason ? `: ${opts.reason}` : ""}`,
      actor,
      [
        store.event(actor, "state_transition", {
          kind: "content",
          subject: c.id,
          from: c.state,
          to: "draft",
          actor: "human",
          reason: opts.reason ?? null,
          actor_name: actor,
        }),
      ],
      [{ kind: "patch", file: c.file_path, patches: { state: "draft" } }],
      [`content ${c.id} sent back to draft${opts.reason ? `: ${opts.reason}` : ""}`],
    );
    out.ok("resolve", { request: `R-${id}`, content: c.id, resolution: "rejected" }, () => {
      out.print(`${c.id} → draft${opts.reason ? ` (reason recorded: ${opts.reason})` : ""}. A builder can revise it on the next build.`);
    });
  }
  assertContentTransition(c.id, c.state as any, "approved", "human");
  await closeCard(
    store,
    id,
    "approved",
    actor,
    [
      store.event(actor, "state_transition", {
        kind: "content",
        subject: c.id,
        from: c.state,
        to: "approved",
        actor: "human",
        actor_name: actor,
      }),
    ],
    [{ kind: "patch", file: c.file_path, patches: { state: "approved" } }],
    [`${actor} approved ${c.id} for publication`],
  );
  out.ok("resolve", { request: `R-${id}`, content: c.id, resolution: "approved" }, () => {
    out.print(`${c.id} approved. Publish it: cronfounder push ${c.id}   (or push all approved: cronfounder push)`);
  });
}

async function resolveSetup(store: Store, out: Out, id: number, kind: string, payload: Record<string, any>, opts: ResolveOpts, actor: string): Promise<void> {
  if (!opts.done) {
    throw new CronfounderError({
      code: "E_RESOLVE_MODE",
      exit: EXIT.VALIDATION,
      problem: `${kind} cards resolve with --done (after completing the steps)`,
      cause: "the card records a human action; the core re-checks reality",
      fix: hintFor(kind, id),
    });
  }
  const db = store.ledger.db;
  const channelId = payload.channel ?? (db.prepare("SELECT blocking_id FROM inbox WHERE id=?").get(id) as any)?.blocking_id;
  if (channelId) {
    const r = channelReadiness(store, String(channelId));
    if (!r.ready) {
      throw new CronfounderError({
        code: "E_STILL_NOT_READY",
        exit: EXIT.VALIDATION,
        problem: `channel "${channelId}" is still not ready: ${r.missing.join("; ")}`,
        cause: "the core re-probes after --done; declaring readiness doesn't create it",
        fix: `finish the remaining steps above, verify with: cronfounder doctor, then retry`,
        retryable: true,
      });
    }
    // unblock hypotheses waiting on this channel
    const blocked = db
      .prepare("SELECT id, file_path, channels_json FROM hypotheses WHERE state='blocked' AND disposition='open'")
      .all() as Array<{ id: string; file_path: string; channels_json: string }>;
    const events: CfEvent[] = [];
    const ops: FileOp[] = [];
    const unblocked: string[] = [];
    for (const h of blocked) {
      const chans = JSON.parse(h.channels_json) as string[];
      if (!chans.includes(String(channelId))) continue;
      const { hypothesisReadiness } = await import("../core/readiness.js");
      const hr = hypothesisReadiness(store, chans);
      if (hr.ready) {
        assertHypothesisTransition(h.id, "blocked", "prioritized", "core");
        events.push(
          store.event("core", "state_transition", { kind: "hypothesis", subject: h.id, from: "blocked", to: "prioritized", actor: "core", ready: true, missing: [] }),
        );
        ops.push({ kind: "patch", file: h.file_path, patches: { state: "prioritized" } });
        unblocked.push(h.id);
      }
    }
    // channel readiness mirror
    const ch = db.prepare("SELECT file_path FROM channels WHERE id=?").get(String(channelId)) as { file_path: string } | undefined;
    if (ch) {
      ops.push({ kind: "patch", file: ch.file_path, patches: { readiness: { ready: true, missing: [], checked_at: iso(now()) } } });
      events.push(store.event("core", "journal_note", { action: "channel_ready", refs: [`channel:${channelId}`], text: `channel ${channelId} probed ready` }));
      db.prepare("UPDATE channels SET ready=1, missing_json='[]' WHERE id=?").run(String(channelId));
    }
    await closeCard(store, id, "done", actor, events, ops, unblocked.length > 0 ? [`unblocked: ${unblocked.join(", ")}`] : []);
    out.ok("resolve", { request: `R-${id}`, resolution: "done", channel: channelId, unblocked }, () => {
      out.print(`channel "${channelId}" is ready.${unblocked.length > 0 ? ` Unblocked: ${unblocked.join(", ")} — fund via cronfounder inbox` : ""}`);
    });
  }
  await closeCard(store, id, "done", actor);
  out.ok("resolve", { request: `R-${id}`, resolution: "done" }, () => out.print(`R-${id} resolved.`));
}

async function resolveDecide(store: Store, out: Out, id: number, payload: Record<string, any>, opts: ResolveOpts, actor: string): Promise<void> {
  const choices = (payload.choices ?? []) as Array<{ key: string }>;
  const choice = opts.choice ?? (opts.approve ? choices[0]?.key : undefined);
  if (!choice || !choices.some((c) => c.key === choice)) {
    throw new CronfounderError({
      code: "E_BAD_CHOICE",
      exit: EXIT.VALIDATION,
      problem: `decide cards need --choice <key>; valid: ${choices.map((c) => c.key).join(", ")}`,
      cause: "an ambiguous decision cannot become a journal fact",
      fix: hintFor("decide", id),
    });
  }
  const db = store.ledger.db;
  const decideKind = payload.decide_kind as string | undefined;
  const events: CfEvent[] = [];
  const ops: FileOp[] = [];
  const prose: string[] = [];

  if (decideKind === "resume_paused" && payload.hypothesis) {
    const h = db.prepare("SELECT id, state, file_path FROM hypotheses WHERE id=?").get(payload.hypothesis) as any;
    if (h && h.state === "paused") {
      if (choice === "resume") {
        assertHypothesisTransition(h.id, "paused", "measuring", "human");
        events.push(store.event(actor, "state_transition", { kind: "hypothesis", subject: h.id, from: "paused", to: "measuring", actor: "human" }));
        ops.push({ kind: "patch", file: h.file_path, patches: { state: "measuring" } });
        prose.push(`${actor} resumed ${h.id} (human-only decision)`);
      } else if (choice === "abandon") {
        events.push(store.event(actor, "disposition_change", { kind: "hypothesis", subject: h.id, disposition: "closed_inconclusive", reason: "abandoned while paused" }));
        ops.push({ kind: "patch", file: h.file_path, patches: { disposition: "closed_inconclusive" } });
        prose.push(`${actor} abandoned ${h.id}; the metric's WIP slot is free`);
      }
    }
  } else if (decideKind === "inconclusive" && payload.hypothesis) {
    const h = db.prepare("SELECT id, state, file_path, duration_days, review_at FROM hypotheses WHERE id=?").get(payload.hypothesis) as any;
    if (h) {
      if (choice === "extend") {
        const newReview = iso(new Date(now().getTime() + h.duration_days * 86400_000));
        events.push(
          store.event(actor, "state_transition", { kind: "hypothesis", subject: h.id, from: h.state, to: h.state, actor: "human", review_at: newReview, reason: "measurement window extended once" }),
        );
        ops.push({ kind: "patch", file: h.file_path, patches: { review_at: newReview } });
        prose.push(`${actor} extended ${h.id} measurement to ${newReview}`);
      } else if (choice === "close") {
        events.push(store.event(actor, "disposition_change", { kind: "hypothesis", subject: h.id, disposition: "closed_inconclusive", reason: "closed inconclusive (no verdict invented)" }));
        ops.push({ kind: "patch", file: h.file_path, patches: { disposition: "closed_inconclusive" } });
        prose.push(`${actor} closed ${h.id} inconclusive — no verdict invented (invariant IX)`);
      }
    }
  } else if (decideKind === "uncertain_push" && payload.intent) {
    const outcome = choice === "published" ? "published" : "failed";
    events.push(store.event(actor, "push_resolved", { intent: payload.intent, outcome, external_id: choice === "published" ? "verified-manually" : null }));
    if (outcome === "published" && payload.content) {
      const c = db.prepare("SELECT id, state, file_path FROM contents WHERE id=?").get(payload.content) as any;
      if (c && c.state === "approved") {
        events.push(store.event("core", "state_transition", { kind: "content", subject: c.id, from: "approved", to: "published", actor: "core" }));
        ops.push({ kind: "patch", file: c.file_path, patches: { state: "published" } });
      }
    }
    prose.push(`${actor} verified uncertain push ${payload.intent}: ${outcome}`);
  }

  await closeCard(store, id, `choice: ${choice}`, actor, events, ops, prose);
  out.ok("resolve", { request: `R-${id}`, choice }, () => out.print(`R-${id} resolved: ${choice}`));
}
