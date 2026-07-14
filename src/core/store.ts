/**
 * The single mutation API (every command and the staging importer go through
 * here — invariants are enforced once, in one place).
 *
 * Write order for every mutation (crash-consistent):
 *   1. append events to journal/events/<day>.jsonl   (the durable fact)
 *   2. apply file ops (atomic tmp+rename)             (mirrors + prose)
 *   3. project events into the ledger, transactionally, recording applied ids
 *
 * A crash after (1) is healed on next open(): unapplied events are replayed
 * (projection is idempotent) and machine-owned file mirrors are repaired from
 * the ledger (fsck).
 */
import path from "node:path";
import { CronfounderError, EXIT } from "../errors.js";
import type { Company } from "./company.js";
import { appendEvents, makeEvent, readAllEvents, type CfEvent, type EventType } from "./events.js";
import { atomicWrite, patchFm, appendLine } from "./fm.js";
import { Ledger } from "./ledger.js";
import { CompanyLock } from "./lock.js";
import { scanDocuments, repairMirrors } from "./scan.js";
import { iso, now, today } from "../ids.js";

export interface FileOp {
  kind: "write" | "patch";
  file: string;
  contents?: string;
  patches?: Record<string, unknown>;
}

export class Store {
  readonly ledger: Ledger;
  private lock: CompanyLock | null = null;

  private constructor(
    readonly company: Company,
    readonly mode: "read" | "mutate",
  ) {
    this.ledger = new Ledger(company.paths.db);
  }

  /**
   * Open the store. Mutating commands: acquire the lock, reconcile unapplied
   * events, scan for human edits, repair drifted mirrors. Read-only commands:
   * no lock, reconcile-in-memory only if needed.
   */
  static async open(
    company: Company,
    mode: "read" | "mutate",
    opts: { command: string; cron?: boolean },
  ): Promise<Store> {
    const store = new Store(company, mode);
    if (mode === "mutate") {
      store.lock = new CompanyLock(company.paths.lock);
      // Commands terminate via process.exit() inside the output layer, which
      // skips finally blocks — release the lock in an exit handler (sync-safe).
      process.on("exit", () => store.lock?.release());
      const res = store.lock.acquire(opts.command);
      if (res.status === "busy") {
        store.ledger.close();
        if (opts.cron) {
          throw new CronfounderError({
            code: "E_BUSY_NOOP",
            exit: EXIT.OK,
            problem: "another run holds the company lock; cron invocation exits quietly",
            cause: "overlapping scheduled runs are expected; the lock keeps mutations serial",
            fix: "none needed",
            retryable: true,
          });
        }
        throw CompanyLock.busyError(res.owner);
      }
      if (res.status === "stale-takeover") {
        await store.append([
          store.event("core", "journal_note", {
            action: "stale_lock_takeover",
            refs: [],
            text: `took over a stale lock left by pid ${res.previous.pid} ("${res.previous.command}")`,
          }),
        ]);
      }
      await store.reconcile();
      await scanDocuments(store);
      await repairMirrors(store);
    } else {
      await store.reconcileReadOnly();
    }
    return store;
  }

  event(actor: string, type: EventType, payload: Record<string, unknown>): CfEvent {
    return makeEvent(this.company.config.machine_id, actor, type, payload);
  }

  /** Append events without file ops (facts only). */
  async append(events: CfEvent[]): Promise<void> {
    await this.commit(events, []);
  }

  /** The one write path. */
  async commit(events: CfEvent[], fileOps: FileOp[], proseLines?: string[]): Promise<void> {
    if (this.mode !== "mutate") {
      throw new CronfounderError({
        code: "E_READONLY",
        exit: EXIT.ERROR,
        problem: "attempted a mutation from a read-only command",
        cause: "internal misuse of the core API — this is a cronfounder bug",
        fix: "report at https://github.com/henriquemeireles7/cronfounder/issues",
      });
    }
    // 1. durable facts
    await appendEvents(this.company.paths.events, events);
    // 2. prose journal (append-only; corrections are new entries — invariant II)
    if (proseLines && proseLines.length > 0) {
      const journalFile = path.join(this.company.paths.journal, `${today()}.md`);
      const stamp = iso(now()).slice(11, 16);
      await appendLine(journalFile, proseLines.map((l) => `- ${stamp}Z ${l}`).join("\n"));
    }
    // 3. file mirrors
    for (const op of fileOps) {
      if (op.kind === "write") {
        await atomicWrite(op.file, op.contents ?? "");
      } else {
        await patchFm(op.file, op.patches ?? {});
      }
    }
    // 4. projection
    this.ledger.transaction(() => {
      for (const e of events) this.ledger.project(e);
    });
  }

  /** Replay any events not yet in applied_events (crash recovery, other-writer catch-up). */
  private async reconcile(): Promise<void> {
    const { events, truncated } = await readAllEvents(this.company.paths.events);
    const unapplied = events.filter((e) => !this.ledger.applied(e.id));
    if (unapplied.length > 0) {
      this.ledger.transaction(() => {
        for (const e of unapplied) this.ledger.project(e);
      });
    }
    if (truncated.length > 0) {
      // Quarantined torn lines: journal the fact once per open (best effort).
      await appendEvents(this.company.paths.events, [
        this.event("core", "journal_note", {
          action: "quarantined_torn_event_lines",
          refs: truncated,
          text: `found ${truncated.length} unreadable event line(s) (${truncated.join(", ")}) — likely a crash mid-append; facts after each torn line are intact`,
        }),
      ]);
    }
  }

  private async reconcileReadOnly(): Promise<void> {
    const { events } = await readAllEvents(this.company.paths.events);
    const unapplied = events.filter((e) => !this.ledger.applied(e.id));
    if (unapplied.length > 0) {
      this.ledger.transaction(() => {
        for (const e of unapplied) this.ledger.project(e);
      });
    }
  }

  nextId(table: "inbox" | "projects" | "tasks" | "watch_windows"): number {
    const row = this.ledger.db.prepare(`SELECT COALESCE(MAX(id), 0) + 1 AS next FROM ${table}`).get() as {
      next: number;
    };
    return row.next;
  }

  close(): void {
    this.lock?.release();
    this.ledger.close();
  }
}
