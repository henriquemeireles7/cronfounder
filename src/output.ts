/**
 * Output discipline:
 *   stdout — the result. Under --json: exactly one envelope object. Otherwise: human rendering.
 *   stderr — all progress, diagnostics, and color.
 *
 * Envelope (v1): { v, ok, code, action, data | error, retryable }
 * Exit codes: 0 ok · 1 error · 2 validation/usage · 3 gate-refused · 4 busy (retryable).
 *
 * Colors follow the ontology's semantic system:
 *   amber = spec/desired · green = status/observed · violet = agents/actors · rust = bets/uncertainty
 * Disabled when not a TTY or NO_COLOR is set.
 */
import pc from "picocolors";
import { CronfounderError, EXIT, type ExitCode } from "./errors.js";

export interface OutOptions {
  json: boolean;
  quiet: boolean;
}

const useColor = process.stderr.isTTY === true && process.env.NO_COLOR === undefined;
const useStdoutColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

function paint(fn: (s: string) => string, s: string, forStdout = false): string {
  return (forStdout ? useStdoutColor : useColor) ? fn(s) : s;
}

// Semantic palette (256-color approximations of the ontology page palette).
export const sem = {
  spec: (s: string) => paint(pc.yellow, s, true), // amber — desired state
  status: (s: string) => paint(pc.green, s, true), // green — observed state
  agent: (s: string) => paint(pc.magenta, s, true), // violet — actors
  bet: (s: string) => paint(pc.red, s, true), // rust — hypotheses/uncertainty
  dim: (s: string) => paint(pc.dim, s, true),
  bold: (s: string) => paint(pc.bold, s, true),
};

export class Out {
  constructor(private opts: OutOptions) {}

  get json(): boolean {
    return this.opts.json;
  }

  /** Progress/diagnostic line → stderr. Suppressed by --quiet. */
  progress(msg: string): void {
    if (!this.opts.quiet) process.stderr.write(msg + "\n");
  }

  /** Human result rendering → stdout (skipped under --json). */
  print(msg: string): void {
    if (!this.opts.json) process.stdout.write(msg + "\n");
  }

  /** Success terminal: emits envelope under --json, then exits. */
  ok(action: string, data: unknown, human?: () => void): never {
    if (this.opts.json) {
      process.stdout.write(
        JSON.stringify({ v: 1, ok: true, code: 0, action, data }) + "\n",
      );
    } else if (human) {
      human();
    }
    process.exit(EXIT.OK);
  }

  /** No-op terminal (nothing was due; used by cron-invoked commands). */
  noop(action: string, reason: string): never {
    if (this.opts.json) {
      process.stdout.write(
        JSON.stringify({ v: 1, ok: true, code: 0, action: `${action}:noop`, data: { reason } }) + "\n",
      );
    } else if (!this.opts.quiet) {
      process.stdout.write(`${reason}\n`);
    }
    process.exit(EXIT.OK);
  }

  /** Error terminal: envelope or human problem/cause/fix block, then exits. */
  fail(err: unknown, action: string): never {
    const e =
      err instanceof CronfounderError
        ? err
        : new CronfounderError({
            code: "E_UNEXPECTED",
            exit: EXIT.ERROR as ExitCode,
            problem: err instanceof Error ? err.message : String(err),
            cause: "an unexpected internal error — this is a cronfounder bug, not your company state",
            fix: "re-run with --json for machine detail; report at https://github.com/henriquemeireles7/cronfounder/issues",
          });
    if (this.opts.json) {
      process.stdout.write(
        JSON.stringify({ v: 1, ok: false, code: e.exit, action, error: e.toJSON(), retryable: e.retryable }) + "\n",
      );
    } else {
      process.stderr.write(sem.bold(`${e.code}`) + `  ${e.problem}\n`);
      process.stderr.write(sem.dim(`  cause: `) + `${e.cause_}\n`);
      process.stderr.write(sem.dim(`  fix:   `) + `${e.fix}\n`);
      process.stderr.write(sem.dim(`  docs:  ${e.docs}\n`));
    }
    process.exit(e.exit);
  }
}
