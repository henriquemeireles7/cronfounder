/**
 * push [content-id] — publish approved content (default: all approved).
 * The full crash-consistent protocol: intent event → driver call → publication
 * event. An uncertain delivery is NEVER auto-retried: it files an urgent
 * decide card, and re-running push refuses while the intent is unresolved.
 * Every successful push opens a watch window (the reflex clock's scope).
 */
import { randomBytes } from "node:crypto";
import { CronfounderError, EXIT, gateRefusal } from "../errors.js";
import { assertContentTransition } from "../core/states.js";
import { getDriver } from "../channels/driver.js";
import { fileRequest } from "../core/inbox.js";
import type { Store } from "../core/store.js";
import type { Out } from "../output.js";
import { iso, now, today } from "../ids.js";
import { containedJoin } from "../core/fm.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface PushResultItem {
  content: string;
  channel: string;
  external_id?: string;
  status: "published" | "failed" | "uncertain" | "refused";
  detail?: string;
}

export async function runPush(store: Store, out: Out, contentId?: string): Promise<PushResultItem[]> {
  const db = store.ledger.db;
  const rows = contentId
    ? (db.prepare("SELECT * FROM contents WHERE id=?").all(contentId) as any[])
    : (db.prepare("SELECT * FROM contents WHERE state='approved' ORDER BY id").all() as any[]);
  if (contentId && rows.length === 0) {
    throw new CronfounderError({
      code: "E_NOT_FOUND",
      exit: EXIT.VALIDATION,
      problem: `content ${contentId} does not exist`,
      cause: "wrong id",
      fix: "see approved content: cronfounder board --json",
    });
  }
  const results: PushResultItem[] = [];
  for (const c of rows) {
    if (c.state !== "approved") {
      throw gateRefusal({
        code: "E_GATE_UNAPPROVED",
        invariant: "III",
        invariantText: "nothing side-effectful skips the gate",
        problem: `${c.id} is ${c.state}, not approved`,
        fix:
          c.state === "pending_approval"
            ? `release it first: cronfounder inbox   (its approve_content card)`
            : c.state === "published"
              ? `${c.id} is already published — nothing to do`
              : `only approved content can push; ${c.id} is still a draft`,
      });
    }
    // unresolved intent → refuse (never double-publish blindly)
    const openIntent = db
      .prepare("SELECT intent, state FROM publications WHERE content=? AND state IN ('intent','uncertain')")
      .get(c.id) as { intent: string; state: string } | undefined;
    if (openIntent) {
      const card = db.prepare("SELECT id FROM inbox WHERE state='open' AND kind='decide' AND blocking_id=?").get(c.id) as
        | { id: number }
        | undefined;
      throw new CronfounderError({
        code: "E_PUSH_PENDING",
        exit: EXIT.GATE,
        problem: `${c.id} has an unresolved push (${openIntent.intent}, state: ${openIntent.state})`,
        cause: "a previous push may have reached the platform; re-pushing could double-post",
        fix: card
          ? `verify on the platform, then resolve: cronfounder resolve R-${card.id} --choice published|failed`
          : `run: cronfounder watch   (it reconciles orphaned intents into a decide card)`,
        invariant: "III",
      });
    }
    // cadence: reserve capacity transactionally (we hold the company lock)
    const channel = db.prepare("SELECT * FROM channels WHERE id=?").get(c.channel) as any;
    if (!channel) {
      throw new CronfounderError({
        code: "E_NOT_FOUND",
        exit: EXIT.ERROR,
        problem: `channel "${c.channel}" for ${c.id} is not registered`,
        cause: "the channel setup file is missing or invalid",
        fix: `check channels/${c.channel}/setup.md; cronfounder doctor`,
      });
    }
    const pushedToday = db
      .prepare("SELECT COUNT(*) n FROM publications WHERE channel=? AND state='published' AND at >= ?")
      .get(c.channel, `${today()}T00:00:00Z`) as { n: number };
    if (pushedToday.n >= channel.cadence_max_per_day) {
      results.push({
        content: c.id,
        channel: c.channel,
        status: "refused",
        detail: `cadence limit reached (${channel.cadence_max_per_day}/day on ${c.channel}) — deferred to tomorrow's pulse`,
      });
      out.progress(`deferred ${c.id}: cadence limit ${channel.cadence_max_per_day}/day on ${c.channel}`);
      continue;
    }

    const driver = getDriver(store.company, channel);
    const payloadPath = containedJoin(path.dirname(c.file_path), c.payload_file);
    if (!payloadPath) {
      throw new CronfounderError({
        code: "E_PATH_ESCAPE",
        exit: EXIT.VALIDATION,
        problem: `${c.id} payload_file "${c.payload_file}" escapes its content directory`,
        cause: "payload_file must be a bare filename; a path separator or '..' would read outside the content dir",
        fix: `fix payload_file in content/${c.id}/meta.md to a plain filename, then re-run push`,
      });
    }
    const payload = await readFile(payloadPath, "utf8");
    const urlSurcharge = channel.kind === "x" && /https?:\/\//i.test(payload);
    if (urlSurcharge) out.progress("warning: X currently charges $0.20 for a post containing a URL");
    const intent = `I-${randomBytes(6).toString("hex")}`;
    await store.append([store.event("core", "push_intent", { intent, content: c.id, channel: c.channel })]);
    out.progress(`pushing ${c.id} → ${c.channel}…`);
    try {
      const res = await driver.push({ type: c.payload_type, content: payload, idempotency_key: intent });
      const hyp = db.prepare("SELECT id, tripwires_json FROM hypotheses WHERE id=?").get(c.hypothesis) as
        | { id: string; tripwires_json: string }
        | undefined;
      const windowId = store.nextId("watch_windows");
      const openedAt = iso();
      const closesAt = iso(new Date(now().getTime() + 60 * 60_000));
      assertContentTransition(c.id, "approved", "published", "core");
      await store.commit(
        [
          store.event("core", "publication", { intent, content: c.id, channel: c.channel, external_id: res.external_id }),
          store.event("core", "state_transition", { kind: "content", subject: c.id, from: "approved", to: "published", actor: "core" }),
          store.event("core", "watch_opened", {
            window: windowId,
            content: c.id,
            hypothesis: hyp?.id ?? c.hypothesis,
            channel: c.channel,
            opened_at: openedAt,
            closes_at: closesAt,
            tripwires: hyp ? JSON.parse(hyp.tripwires_json) : [],
          }),
        ],
        [{ kind: "patch", file: c.file_path, patches: { state: "published" } }],
        [`published ${c.id} on ${c.channel} (external id ${res.external_id}); watch window open until ${closesAt}`],
      );
      results.push({
        content: c.id,
        channel: c.channel,
        external_id: res.external_id,
        status: "published",
        detail: urlSurcharge ? "X URL-post surcharge: $0.20 at current pay-per-use pricing" : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof CronfounderError && e.code !== "E_PUSH_UNCERTAIN") {
        const detail = `${e.problem}: ${e.cause_}`;
        await store.append([store.event("core", "push_resolved", { intent, outcome: "failed" })]);
        results.push({ content: c.id, channel: c.channel, status: "failed", detail });
        out.progress(`failed: ${c.id} — ${detail}`);
        continue;
      }
      await store.append([store.event("core", "push_uncertain", { intent, content: c.id, channel: c.channel, error: msg })]);
      const card = await fileRequest(
        store,
        "core",
        "decide",
        {
          what: `a push of ${c.id} to "${c.channel}" ended UNCERTAIN — it may or may not have reached the platform`,
          why: "auto-retrying an uncertain delivery risks double-posting; only a human (or their delegated agent) can verify",
          steps: [
            `open ${c.channel} and check whether the post appeared`,
            `then resolve this card with what you found`,
          ],
          blocking: `any further pushes of ${c.id}`,
          context: msg,
          choices: [
            { key: "published", label: "it IS on the platform — record the publication" },
            { key: "failed", label: "it is NOT there — clear the intent so push can retry" },
          ],
          decide_kind: "uncertain_push",
          intent,
          content: c.id,
        } as any,
        { blockingKind: "content", blockingId: c.id, urgent: true },
      );
      results.push({ content: c.id, channel: c.channel, status: "uncertain", detail: `decide card R-${card}` });
      out.progress(`UNCERTAIN: ${c.id} — verify and resolve R-${card}`);
    }
  }
  return results;
}

export async function pushCommand(store: Store, out: Out, contentId?: string): Promise<void> {
  const results = await runPush(store, out, contentId);
  if (results.length === 0) {
    out.noop("push", "nothing approved to push — the gate has released no content");
  }
  out.ok("push", { results }, () => {
    for (const r of results) {
      out.print(
        `${r.content} → ${r.channel}: ${r.status}${r.external_id ? ` (${r.external_id})` : ""}${r.detail ? ` — ${r.detail}` : ""}`,
      );
    }
  });
}
