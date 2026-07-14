/**
 * Company directory discovery and layout.
 *
 * A company dir is marked by `.cronfounder/config.json` (human-owned runtime config).
 * Discovery: --company flag > CRONFOUNDER_DIR env > walk up from cwd (like git).
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CronfounderError, EXIT } from "../errors.js";

export const ConfigSchema = z.object({
  v: z.literal(1),
  company: z.string().min(1),
  machine_id: z.string().min(1),
  currency: z.string().length(3).default("usd"),
  freshness_hours: z.number().int().positive().default(48),
  runtime: z
    .object({
      adapter: z.enum(["claude", "stub", "none"]).default("none"),
      command: z.string().optional(),
      timeout_s: z.number().int().positive().default(600),
      max_turns: z.number().int().positive().default(30),
    })
    .default({ adapter: "none", timeout_s: 600, max_turns: 30 }),
  /**
   * Executable driver mappings. HUMAN-OWNED: the core spawns nothing that is
   * not declared here. Channel setup.md files reference these by key and are
   * descriptive only (a model can draft setup.md; it cannot add an executable).
   */
  drivers: z
    .record(
      z.object({
        transport: z.literal("stdio"),
        command: z.string(),
        args: z.array(z.string()).default([]),
        env_refs: z.array(z.string()).default([]),
        tools: z.record(
          z.object({
            tool: z.string(),
            /** static args merged with payload fields; values may template {{payload}}, {{text}} */
            args_template: z.record(z.unknown()).default({}),
            /** dot-path with numeric indexes into the tool result, e.g. "content.0.text" */
            extract: z.string().default(""),
            timeout_s: z.number().int().positive().default(60),
          }),
        ),
      }),
    )
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

export interface Company {
  dir: string;
  config: Config;
  paths: ReturnType<typeof companyPaths>;
}

export function companyPaths(dir: string) {
  return {
    dir,
    config: path.join(dir, ".cronfounder", "config.json"),
    db: path.join(dir, "company.db"),
    lock: path.join(dir, ".cronfounder", "lock"),
    staging: path.join(dir, ".cronfounder", "staging"),
    runs: path.join(dir, ".cronfounder", "runs"),
    siteOut: path.join(dir, ".cronfounder", "site"),
    mockState: path.join(dir, ".cronfounder", "mock"),
    agentsMd: path.join(dir, "AGENTS.md"),
    doctrine: path.join(dir, "doctrine"),
    identity: path.join(dir, "doctrine", "identity.md"),
    constitution: path.join(dir, "doctrine", "constitution.md"),
    metrics: path.join(dir, "metrics"),
    channels: path.join(dir, "channels"),
    playbooks: path.join(dir, "playbooks"),
    hypotheses: path.join(dir, "hypotheses"),
    content: path.join(dir, "content"),
    journal: path.join(dir, "journal"),
    events: path.join(dir, "journal", "events"),
    inbox: path.join(dir, "inbox"),
  };
}

export function isCompanyDir(dir: string): boolean {
  return existsSync(path.join(dir, ".cronfounder", "config.json"));
}

export function findCompanyDir(explicit?: string): string {
  if (explicit) {
    const abs = path.resolve(explicit);
    if (isCompanyDir(abs)) return abs;
    throw notACompany(abs, "--company points at a directory without .cronfounder/config.json");
  }
  const env = process.env.CRONFOUNDER_DIR;
  if (env) {
    const abs = path.resolve(env);
    if (isCompanyDir(abs)) return abs;
    throw notACompany(abs, "CRONFOUNDER_DIR points at a directory without .cronfounder/config.json");
  }
  let cur = process.cwd();
  for (;;) {
    if (isCompanyDir(cur)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw notACompany(process.cwd(), "no company found walking up from the current directory");
}

function notACompany(dir: string, cause: string): CronfounderError {
  return new CronfounderError({
    code: "E_NO_COMPANY",
    exit: EXIT.VALIDATION,
    problem: `not inside a cronfounder company (looked at ${dir})`,
    cause,
    fix: "cd into your company directory, pass --company <dir>, or create one: cronfounder init <dir>",
  });
}

export async function loadCompany(explicit?: string): Promise<Company> {
  const dir = findCompanyDir(explicit);
  const raw = await readFile(companyPaths(dir).config, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CronfounderError({
      code: "E_CONFIG_INVALID",
      exit: EXIT.VALIDATION,
      problem: `.cronfounder/config.json is not valid JSON`,
      cause: "the file was hand-edited into an invalid state or truncated by a crash",
      fix: `fix the JSON syntax in ${companyPaths(dir).config} (this file is human-owned; cronfounder never rewrites it)`,
    });
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new CronfounderError({
      code: "E_CONFIG_INVALID",
      exit: EXIT.VALIDATION,
      problem: `.cronfounder/config.json failed validation at "${first?.path.join(".")}": ${first?.message}`,
      cause: "a field is missing or has the wrong type",
      fix: "compare against the config reference in docs/commands.md#configuration",
    });
  }
  return { dir, config: result.data, paths: companyPaths(dir) };
}
