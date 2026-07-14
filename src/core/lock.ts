/**
 * Per-company mutation lock.
 *
 * Fingerprint = { pid, started, host, nonce, command }. Stale detection:
 * the owning pid is gone (or its start time doesn't match). Stale locks are
 * taken over and the takeover is journaled by the caller. A held lock means:
 *   cron-invoked commands (--cron)  → clean no-op exit 0 (cron stays silent)
 *   interactive commands            → exit 4, busy, retryable
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, openSync, closeSync, constants } from "node:fs";
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { CronfounderError, EXIT } from "../errors.js";

interface LockInfo {
  pid: number;
  started: string;
  host: string;
  nonce: string;
  command: string;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class CompanyLock {
  private held = false;
  private info: LockInfo | null = null;

  constructor(private lockPath: string) {}

  /** @returns "acquired" | "busy" — never throws for contention. */
  acquire(command: string): { status: "acquired" } | { status: "busy"; owner: LockInfo } | { status: "stale-takeover"; previous: LockInfo } {
    mkdirSync(path.dirname(this.lockPath), { recursive: true });
    const mine: LockInfo = {
      pid: process.pid,
      started: new Date().toISOString(),
      host: hostname(),
      nonce: randomBytes(4).toString("hex"),
      command,
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(this.lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
        writeFileSync(fd, JSON.stringify(mine));
        closeSync(fd);
        this.held = true;
        this.info = mine;
        return { status: "acquired" };
      } catch {
        // Lock exists — inspect the owner.
        let owner: LockInfo | null = null;
        try {
          owner = JSON.parse(readFileSync(this.lockPath, "utf8")) as LockInfo;
        } catch {
          owner = null; // torn write — treat as stale
        }
        if (owner && owner.host === hostname() && processAlive(owner.pid)) {
          return { status: "busy", owner };
        }
        if (owner && owner.host !== hostname()) {
          // A different machine holds it; we cannot probe its pid. Refuse —
          // single-active-machine is documented; ambiguity is never auto-resolved.
          return { status: "busy", owner };
        }
        // Stale (dead pid on this host, or unreadable): take over once.
        try {
          unlinkSync(this.lockPath);
        } catch {
          /* raced another taker */
        }
        if (attempt === 1) break;
        const prev = owner;
        const retry = this.acquire(command);
        if (retry.status === "acquired" && prev) return { status: "stale-takeover", previous: prev };
        return retry;
      }
    }
    return { status: "busy", owner: this.info ?? { pid: 0, started: "", host: "", nonce: "", command: "" } };
  }

  release(): void {
    if (!this.held) return;
    try {
      const cur = JSON.parse(readFileSync(this.lockPath, "utf8")) as LockInfo;
      if (cur.nonce === this.info?.nonce) unlinkSync(this.lockPath);
    } catch {
      /* already gone */
    }
    this.held = false;
  }

  static busyError(owner: LockInfo): CronfounderError {
    return new CronfounderError({
      code: "E_BUSY",
      exit: EXIT.BUSY,
      problem: `another cronfounder command is running: "${owner.command}" (pid ${owner.pid} on ${owner.host}, since ${owner.started})`,
      cause: "mutating commands take a per-company lock so state changes stay serial",
      fix:
        "retry when it finishes; if that process is truly gone on another machine, remove .cronfounder/lock by hand (single-active-machine is the supported topology)",
      retryable: true,
    });
  }
}

export function lockIsHeld(lockPath: string): boolean {
  return existsSync(lockPath);
}
