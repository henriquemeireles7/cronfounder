/**
 * Shared command plumbing: global flags, store lifecycle, error discipline.
 * Interactive prompts NEVER happen when stdin is not a TTY — commands exit 2
 * naming the exact flag instead (a hidden prompt is a hung agent session).
 */
import { createInterface } from "node:readline/promises";
import { loadCompany, type Company } from "../core/company.js";
import { Store } from "../core/store.js";
import { CronfounderError, EXIT } from "../errors.js";
import { Out } from "../output.js";

export interface GlobalOpts {
  json: boolean;
  quiet: boolean;
  company?: string;
  cron: boolean;
  runtime?: string;
}

export function outFor(opts: GlobalOpts): Out {
  return new Out({ json: opts.json, quiet: opts.quiet });
}

export async function withStore(
  opts: GlobalOpts,
  mode: "read" | "mutate",
  commandName: string,
  fn: (store: Store, out: Out, company: Company) => Promise<void>,
): Promise<void> {
  const out = outFor(opts);
  let store: Store | null = null;
  try {
    const company = await loadCompany(opts.company);
    store = await Store.open(company, mode, { command: commandName, cron: opts.cron });
    await fn(store, out, company);
  } catch (e) {
    if (e instanceof CronfounderError && e.code === "E_BUSY_NOOP") {
      store?.close();
      out.noop(commandName, "another run holds the company lock; exiting quietly (--cron)");
    }
    store?.close();
    out.fail(e, commandName);
  } finally {
    store?.close();
  }
}

export async function ask(question: string, fallbackFlag: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new CronfounderError({
      code: "E_NEEDS_TTY",
      exit: EXIT.VALIDATION,
      problem: `this step needs an answer and stdin is not a terminal`,
      cause: "cronfounder never blocks waiting for input a scheduler or agent can't give",
      fix: `pass ${fallbackFlag} to answer non-interactively`,
    });
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

export function requireArg<T>(value: T | undefined, name: string, example: string): T {
  if (value === undefined || value === null || value === ("" as unknown as T)) {
    throw new CronfounderError({
      code: "E_MISSING_ARG",
      exit: EXIT.VALIDATION,
      problem: `missing required argument: ${name}`,
      cause: "the command cannot infer this value",
      fix: `example: ${example}`,
    });
  }
  return value;
}
