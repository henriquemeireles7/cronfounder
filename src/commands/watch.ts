/**
 * watch — the watchdog (reflex clock). Judges HARM only, never success:
 * evaluates tripwires on open windows, pauses the hypothesis and pages the
 * human (urgent card) on a trip. Also reconciles orphaned push intents and
 * re-escalates stale pauses. No-ops fast when nothing is open (cron-safe).
 */
import { getDriver } from "../channels/driver.js";
import { assertHypothesisTransition } from "../core/states.js";
import { fileRequest } from "../core/inbox.js";
import type { Store } from "../core/store.js";
import type { Out } from "../output.js";
import { iso, now } from "../ids.js";
import type { TripwireSchema } from "../core/schema.js";
import type { z } from "zod";

type Tripwire = z.infer<typeof TripwireSchema>;

export interface WatchResult {
  evaluated: number;
  tripped: Array<{ window: number; hypothesis: string; signal: string; observed: number; threshold: number }>;
  closed: number[];
  orphan_intents: string[];
  nothing_due: boolean;
}

export async function runWatch(store: Store, out: Out): Promise<WatchResult> {
  const db = store.ledger.db;
  const result: WatchResult = { evaluated: 0, tripped: [], closed: [], orphan_intents: [], nothing_due: false };
  const nowMs = now().getTime();

  // 1. orphaned push intents (crash between intent and outcome) → decide card
  const orphans = db
    .prepare("SELECT intent, content, channel, at FROM publications WHERE state='intent'")
    .all() as Array<{ intent: string; content: string; channel: string; at: string }>;
  for (const o of orphans) {
    if (nowMs - new Date(o.at).getTime() < 5 * 60_000) continue; // still in flight, plausibly
    const existing = db.prepare("SELECT id FROM inbox WHERE state='open' AND kind='decide' AND blocking_id=?").get(o.content);
    if (!existing) {
      const card = await fileRequest(
        store,
        "watchdog",
        "decide",
        {
          what: `push intent ${o.intent} for ${o.content} never recorded an outcome (crashed mid-push?)`,
          why: "the post may or may not exist on the platform; re-pushing blindly could double-post",
          steps: [`check "${o.channel}" for the post`, `resolve this card with what you found`],
          blocking: `pushes of ${o.content}`,
          choices: [
            { key: "published", label: "it IS there — record the publication" },
            { key: "failed", label: "it is NOT there — clear the intent" },
          ],
          decide_kind: "uncertain_push",
          intent: o.intent,
          content: o.content,
        } as any,
        { blockingKind: "content", blockingId: o.content, urgent: true },
      );
      result.orphan_intents.push(o.intent);
      out.progress(`orphaned push intent ${o.intent} → decide card R-${card}`);
    }
  }

  // 2. open windows
  const windows = db
    .prepare("SELECT * FROM watch_windows WHERE state='open' ORDER BY id")
    .all() as Array<{ id: number; content: string; hypothesis: string; channel: string; opened_at: string; closes_at: string; tripwires: string }>;
  if (windows.length === 0 && orphans.length === 0) {
    const stale = await escalateStalePauses(store, out);
    result.nothing_due = stale === 0;
    return result;
  }

  for (const w of windows) {
    result.evaluated++;
    const tripwires = (JSON.parse(w.tripwires) as Tripwire[]).filter((t) => t.source === w.channel);
    let signals: Array<{ id: string; signal: string; value: number; at: string }> = [];
    if (tripwires.length > 0) {
      const channel = db.prepare("SELECT * FROM channels WHERE id=?").get(w.channel) as any;
      try {
        const driver = getDriver(store.company, channel);
        signals = await driver.pull(w.opened_at);
      } catch (e) {
        out.progress(`watch: pull() failed on ${w.channel}: ${e instanceof Error ? e.message.split("\n")[0] : e} — window stays open`);
        continue;
      }
    }
    let trippedThis = false;
    for (const t of tripwires) {
      const windowStart = nowMs - t.window_minutes * 60_000;
      const relevant = signals.filter((s) => s.signal === t.signal && new Date(s.at).getTime() >= windowStart);
      const seen = new Set<string>();
      const deduped = relevant.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
      if (deduped.length < t.min_samples) continue;
      const observed =
        t.aggregation === "count"
          ? deduped.length
          : t.aggregation === "sum"
            ? deduped.reduce((a, s) => a + s.value, 0)
            : deduped.reduce((a, s) => Math.max(a, s.value), 0);
      const hit = t.comparator === ">" ? observed > t.threshold : observed >= t.threshold;
      if (!hit) continue;
      trippedThis = true;
      result.tripped.push({ window: w.id, hypothesis: w.hypothesis, signal: t.signal, observed, threshold: t.threshold });
      const h = db.prepare("SELECT id, state, file_path FROM hypotheses WHERE id=?").get(w.hypothesis) as any;
      const events = [
        store.event("watchdog", "tripwire_fired", { window: w.id, hypothesis: w.hypothesis, signal: t.signal, observed, threshold: t.threshold }),
        store.event("watchdog", "watch_closed", { window: w.id, outcome: "tripped" }),
      ];
      const ops = [] as Array<{ kind: "patch"; file: string; patches: Record<string, unknown> }>;
      if (h && (h.state === "active" || h.state === "measuring")) {
        assertHypothesisTransition(h.id, h.state, "paused", "watchdog");
        events.push(store.event("watchdog", "state_transition", { kind: "hypothesis", subject: h.id, from: h.state, to: "paused", actor: "watchdog", reason: `tripwire ${t.signal}` }));
        ops.push({ kind: "patch", file: h.file_path, patches: { state: "paused" } });
      }
      await store.commit(events, ops, [
        `🚨 watchdog tripped on ${w.hypothesis}: ${t.signal} ${t.comparator} ${t.threshold} (observed ${observed}) — hypothesis paused, human paged`,
      ]);
      await fileRequest(
        store,
        "watchdog",
        "decide",
        {
          what: `tripwire fired: ${t.signal} observed ${observed} (threshold ${t.comparator} ${t.threshold}) after pushing ${w.content} to ${w.channel}`,
          why: `${w.hypothesis} is PAUSED and holds its metric's WIP slot; the watchdog judges harm only — resuming is yours alone`,
          steps: [`review the signals on ${w.channel}`, `decide below`],
          blocking: `all work on ${w.hypothesis} and its metric`,
          choices: [
            { key: "resume", label: "false alarm — resume measuring" },
            { key: "abandon", label: "real damage — abandon the bet (frees the metric; no verdict invented)" },
          ],
          decide_kind: "resume_paused",
          hypothesis: w.hypothesis,
        } as any,
        { blockingKind: "hypothesis", blockingId: w.hypothesis, urgent: true },
      );
      break; // one trip closes the window
    }
    if (!trippedThis && new Date(w.closes_at).getTime() <= nowMs) {
      await store.append([store.event("watchdog", "watch_closed", { window: w.id, outcome: "clean" })]);
      result.closed.push(w.id);
    }
  }

  await escalateStalePauses(store, out);
  return result;
}

async function escalateStalePauses(store: Store, out: Out): Promise<number> {
  const db = store.ledger.db;
  const nowMs = now().getTime();
  const paused = db
    .prepare("SELECT id FROM hypotheses WHERE state='paused' AND disposition='open'")
    .all() as Array<{ id: string }>;
  let escalated = 0;
  for (const h of paused) {
    const openCard = db.prepare("SELECT 1 FROM inbox WHERE state='open' AND blocking_id=?").get(h.id);
    if (openCard) continue;
    const lastCard = db
      .prepare("SELECT MAX(resolved_at) t FROM inbox WHERE blocking_id=?")
      .get(h.id) as { t: string | null };
    const since = lastCard.t ? new Date(lastCard.t).getTime() : 0;
    if (nowMs - since < 7 * 86400_000) continue;
    await fileRequest(
      store,
      "watchdog",
      "decide",
      {
        what: `${h.id} has been paused for over 7 days and still holds its metric's WIP slot`,
        why: "a forgotten pause starves the metric forever — decide, don't drift",
        steps: [],
        blocking: `the metric behind ${h.id}`,
        choices: [
          { key: "resume", label: "resume measuring" },
          { key: "abandon", label: "abandon the bet (frees the slot)" },
        ],
        decide_kind: "resume_paused",
        hypothesis: h.id,
      } as any,
      { blockingKind: "hypothesis", blockingId: h.id, urgent: true },
    );
    escalated++;
    out.progress(`re-escalated stale pause on ${h.id}`);
  }
  return escalated;
}

export async function watchCommand(store: Store, out: Out): Promise<void> {
  const result = await runWatch(store, out);
  if (result.nothing_due && result.evaluated === 0 && result.orphan_intents.length === 0) {
    out.noop("watch", "no open watch windows — the reflex clock is silent when nothing is live");
  }
  out.ok("watch", result, () => {
    out.print(`evaluated ${result.evaluated} window(s); ${result.tripped.length} tripped; ${result.closed.length} closed clean`);
    for (const t of result.tripped) out.print(`🚨 ${t.hypothesis}: ${t.signal} observed ${t.observed} ≥ ${t.threshold} — paused, human paged`);
  });
}

export { iso };
