/**
 * Typed errors for the deterministic core.
 *
 * Every failure a user (human or agent) can hit carries:
 *   code      stable machine-matchable identifier (E_*)
 *   exit      process exit code: 1 error, 2 validation/usage, 3 gate-refused, 4 busy/locked
 *   problem   what happened
 *   cause     why it happened
 *   fix       what to do about it (exact commands where possible)
 *   docs      anchor into docs/errors.md
 *   invariant the spec invariant that refused, when a gate said no (I..X)
 *   retryable whether retrying the same command can succeed without changes
 */

export const EXIT = {
  OK: 0,
  ERROR: 1,
  VALIDATION: 2,
  GATE: 3,
  BUSY: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface ErrorSpec {
  code: string;
  exit: ExitCode;
  problem: string;
  cause: string;
  fix: string;
  invariant?: string;
  retryable?: boolean;
  docs?: string;
}

export class CronfounderError extends Error {
  readonly code: string;
  readonly exit: ExitCode;
  readonly problem: string;
  readonly cause_: string;
  readonly fix: string;
  readonly invariant?: string;
  readonly retryable: boolean;
  readonly docs: string;

  constructor(spec: ErrorSpec) {
    super(`${spec.code}: ${spec.problem}`);
    this.name = "CronfounderError";
    this.code = spec.code;
    this.exit = spec.exit;
    this.problem = spec.problem;
    this.cause_ = spec.cause;
    this.fix = spec.fix;
    this.invariant = spec.invariant;
    this.retryable = spec.retryable ?? false;
    this.docs = spec.docs ?? `docs/errors.md#${spec.code.toLowerCase().replace(/_/g, "-")}`;
  }

  toJSON() {
    return {
      code: this.code,
      invariant: this.invariant,
      problem: this.problem,
      cause: this.cause_,
      fix: this.fix,
      docs: this.docs,
      retryable: this.retryable,
    };
  }
}

/** Gate refusals read as the product working, not as a crash. */
export function gateRefusal(opts: {
  code: string;
  invariant: string;
  invariantText: string;
  problem: string;
  fix: string;
}): CronfounderError {
  return new CronfounderError({
    code: opts.code,
    exit: EXIT.GATE,
    problem: `refused (invariant ${opts.invariant}): ${opts.problem} — ${opts.invariantText}`,
    cause: `invariant ${opts.invariant} is enforced by the deterministic core; no actor can override it`,
    fix: opts.fix,
    invariant: opts.invariant,
    retryable: false,
  });
}

export function validationError(problem: string, cause: string, fix: string, code = "E_VALIDATION"): CronfounderError {
  return new CronfounderError({ code, exit: EXIT.VALIDATION, problem, cause, fix });
}
