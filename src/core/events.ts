/**
 * The event catalog — the machine layer of the journal (invariant II + V).
 *
 * journal/events/YYYY-MM-DD.jsonl is append-only, in git, sharded by day.
 * Events are the authoritative record for FACTS (transitions, measurements,
 * publications, resolutions). Files remain authoritative for PROSE and
 * human-owned intent fields. The ledger is a projection: replaying all event
 * shards over the scanned files reproduces it exactly (`rebuild`).
 *
 * Every ledger column's authority source is either a file field (imported at
 * scan) or an event payload (projected at replay) — never both.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { appendLine } from "./fm.js";
import { eventId, iso, now, today } from "../ids.js";

export const EVENT_VERSION = 1;

export type EventType =
  | "company_initialized"
  | "sensor_reading" // {metric, value, measured_at, sensor}
  | "sensor_failure" // {metric, sensor, error}
  | "artifact_registered" // {kind, id, path, human_hash, machine_hash}
  | "spec_set" // {metric, target, deadline, set_by, baseline_value}
  | "state_transition" // {kind, id, from, to, actor, reason?, snapshot?}
  | "disposition_change" // {kind, id, disposition, reason, actor}
  | "compiled" // {hypothesis, projects: [{id,type,channel,builder}], tasks: [{id,project,kind}]}
  | "task_event" // {task, project, from, to, claimed_by?}
  | "inbox_created" // {request, kind, payload, blocking_kind, blocking_id, urgent}
  | "inbox_resolved" // {request, resolution, actor, choice?, reason?}
  | "push_intent" // {intent, content, channel}
  | "publication" // {intent, content, channel, external_id}
  | "push_uncertain" // {intent, content, channel, error}
  | "push_resolved" // {intent, outcome: published|failed, external_id?}
  | "watch_opened" // {window, content, hypothesis, channel, opened_at, closes_at, tripwires}
  | "watch_closed" // {window, outcome}
  | "tripwire_fired" // {window, hypothesis, signal, observed, threshold}
  | "verdict" // {hypothesis, result, delta, baseline_reading, terminal_reading, algorithm_v}
  | "human_edit" // {path, fields}
  | "journal_note"; // {actor, action, refs, text}

export interface CfEvent {
  id: string;
  v: number;
  at: string;
  machine: string;
  actor: string;
  type: EventType;
  [key: string]: unknown;
}

export function makeEvent(machine: string, actor: string, type: EventType, payload: Record<string, unknown>): CfEvent {
  // Envelope fields ALWAYS win: a payload key like "id" must never clobber
  // the event's identity (that breaks dedup and skips projections).
  return { ...payload, id: eventId(), v: EVENT_VERSION, at: iso(), machine, actor, type };
}

export function eventsFileFor(eventsDir: string, date = today()): string {
  return path.join(eventsDir, `${date}.jsonl`);
}

/** Append events to today's shard. This is the FIRST write of every mutation. */
export async function appendEvents(eventsDir: string, events: CfEvent[]): Promise<void> {
  if (events.length === 0) return;
  const file = eventsFileFor(eventsDir);
  const lines = events.map((e) => JSON.stringify(e)).join("\n");
  await appendLine(file, lines);
}

/**
 * Read every event across all shards in (day, position) order.
 * A truncated trailing line (crash mid-append / disk full) is quarantined:
 * returned in `truncated` for the caller to journal, never thrown.
 */
export async function readAllEvents(eventsDir: string): Promise<{ events: CfEvent[]; truncated: string[] }> {
  const events: CfEvent[] = [];
  const truncated: string[] = [];
  if (!existsSync(eventsDir)) return { events, truncated };
  const files = (await readdir(eventsDir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
  for (const f of files) {
    const raw = await readFile(path.join(eventsDir, f), "utf8");
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (line === "") continue;
      try {
        const parsed = JSON.parse(line) as CfEvent;
        if (typeof parsed.id === "string" && typeof parsed.type === "string") events.push(parsed);
        else truncated.push(`${f}:${i + 1}`);
      } catch {
        if (i === lines.length - 1 || (i === lines.length - 2 && lines[lines.length - 1] === "")) {
          truncated.push(`${f}:${i + 1}`); // torn tail — quarantine
        } else {
          truncated.push(`${f}:${i + 1} (mid-file corruption)`);
        }
      }
    }
  }
  return { events, truncated };
}

export function nowIso(): string {
  return iso(now());
}
