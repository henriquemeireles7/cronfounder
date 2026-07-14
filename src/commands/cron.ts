/**
 * cron print | install | status — the three clocks as crontab lines.
 * Lines are durable: absolute node + cli paths (refused if they resolve into
 * an npx/temp cache that will be pruned), sourcing an optional env file
 * (cron does not load your shell profile), every command --cron --quiet
 * (lock contention exits 0 silently; catch-up semantics handle downtime).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CronfounderError, EXIT } from "../errors.js";
import type { Store } from "../core/store.js";
import type { Out } from "../output.js";
import { ask } from "./helpers.js";

const MARKER_BEGIN = "# >>> cronfounder clocks >>>";
const MARKER_END = "# <<< cronfounder clocks <<<";

/** POSIX single-quote a value so a space or embedded quote can't break the /bin/sh -c line. */
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function cronLines(companyDir: string): { lines: string[]; binPath: string; durable: boolean } {
  const node = process.execPath;
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const durable = !/\/_npx\/|\/\.npm\/_cacache\/|\/tmp\//.test(cli);
  const env = path.join(companyDir, ".cronfounder", "env");
  // a crontab entry is one line; single quotes are escapable, a newline is not.
  // (env derives from companyDir, so checking companyDir covers it)
  for (const [label, v] of [["company dir", companyDir], ["node path", node], ["cli path", cli]] as const) {
    if (/[\r\n]/.test(v)) {
      throw new CronfounderError({
        code: "E_VALIDATION",
        exit: EXIT.VALIDATION,
        problem: `${label} contains a newline — refusing to build cron lines`,
        cause: "a crontab entry is a single line; a newline in a path would corrupt the crontab",
        fix: "move the company to a path without newline characters, then re-run cron print/install",
      });
    }
  }
  // each path is single-quoted for the inner shell, then the whole script is
  // single-quoted for /bin/sh -c (escaping the inner quotes) — safe under spaces and quotes.
  const wrap = (cmd: string) =>
    `/bin/sh -c ${shq(`. ${shq(env)} 2>/dev/null; ${shq(node)} ${shq(cli)} ${cmd} --company ${shq(companyDir)} --cron --quiet`)}`;
  const lines = [
    MARKER_BEGIN,
    `# pulse (daily): reality first, diff second — sense then plan, one chained invocation`,
    `7 7 * * * ${wrap("sense")} && ${wrap("plan")}`,
    `# reflex (every 10 min): watchdog — no-ops instantly when no windows are open`,
    `*/10 * * * * ${wrap("watch")}`,
    `# season (daily): verdicts for every overdue review_at (catch-up safe)`,
    `17 8 * * * ${wrap("verdict")}`,
    MARKER_END,
  ];
  return { lines, binPath: cli, durable };
}

/** The cron env file is shell-sourced credentials — ensure it exists and is private (0600). */
function ensureEnvFile(companyDir: string, out: Out): void {
  const dir = path.join(companyDir, ".cronfounder");
  const env = path.join(dir, "env");
  if (!existsSync(env)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      env,
      [
        "# cronfounder cron env — sourced by the cron clocks; keep it private (0600).",
        "# add sensor/channel credentials as shell assignments, one per line:",
        "#   export GITHUB_TOKEN=ghp_...",
        "#   export STRIPE_API_KEY=sk_live_...",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    chmodSync(env, 0o600); // defeat a permissive umask
    out.progress(`created ${env} (0600) — put sensor credentials there`);
    return;
  }
  if ((statSync(env).mode & 0o077) !== 0) {
    chmodSync(env, 0o600);
    out.progress(`tightened ${env} to 0600 (it holds shell-sourced credentials)`);
  }
}

export async function cronCommand(store: Store, out: Out, sub: string, yes: boolean): Promise<void> {
  const { lines, binPath, durable } = cronLines(store.company.dir);
  if (sub === "print" || sub === "install") ensureEnvFile(store.company.dir, out);
  if (sub === "print") {
    out.ok("cron:print", { lines, bin: binPath, durable }, () => {
      out.print(lines.join("\n"));
      if (!durable) out.print(`\nwarning: ${binPath} lives in an ephemeral npx cache — install durably before installing cron (see docs/installation.md)`);
      out.print(`\ninstall them: cronfounder cron install`);
      out.print(`credential env vars for sensors go in: ${store.company.dir}/.cronfounder/env (chmod 600)`);
    });
  }
  if (sub === "status") {
    const current = spawnSync("crontab", ["-l"], { encoding: "utf8" });
    const installed = current.status === 0 && String(current.stdout).includes(MARKER_BEGIN);
    out.ok("cron:status", { installed, durable, bin: binPath }, () => {
      out.print(installed ? "clocks installed" : "clocks NOT installed — the loop only runs when you run it");
    });
  }
  if (sub === "uninstall") {
    const current = spawnSync("crontab", ["-l"], { encoding: "utf8" });
    const existing = current.status === 0 ? String(current.stdout) : "";
    if (!existing.includes(MARKER_BEGIN)) {
      out.noop("cron:uninstall", "no cronfounder lines in crontab — nothing to remove");
    }
    const re = new RegExp(`${MARKER_BEGIN}[\\s\\S]*?${MARKER_END}\\n?`);
    const write = spawnSync("crontab", ["-"], { input: existing.replace(re, ""), encoding: "utf8" });
    if (write.status !== 0) {
      throw new CronfounderError({
        code: "E_CRONTAB",
        exit: EXIT.ERROR,
        problem: "crontab refused the update",
        cause: write.stderr?.slice(0, 200) ?? "unknown crontab error",
        fix: "remove by hand: crontab -e   (delete the block between the cronfounder markers)",
      });
    }
    out.ok("cron:uninstall", { removed: true }, () => {
      out.print("clocks removed — the loop now runs only when you run it. reinstall: cronfounder cron install");
    });
  }
  if (sub !== "install") {
    throw new CronfounderError({
      code: "E_USAGE",
      exit: EXIT.VALIDATION,
      problem: `unknown cron subcommand "${sub}"`,
      cause: "cron takes: print | install | status | uninstall",
      fix: "cronfounder cron print",
    });
  }
  if (!durable) {
    throw new CronfounderError({
      code: "E_EPHEMERAL_BIN",
      exit: EXIT.VALIDATION,
      problem: `refusing to install cron lines pointing into an npx cache (${binPath})`,
      cause: "npx caches get pruned — the clocks would die silently weeks from now",
      fix: "install durably first: npm install -g <path-or-package>  (docs/installation.md#durable-install), then re-run cron install",
    });
  }
  if (!yes) {
    const answer = await ask(`install 3 cron lines into your crontab? [y/N] `, "--yes");
    if (answer.toLowerCase() !== "y") {
      out.noop("cron:install", "not installed (answered no) — print them any time: cronfounder cron print");
    }
  }
  const current = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  let existing = current.status === 0 ? String(current.stdout) : "";
  if (existing.includes(MARKER_BEGIN)) {
    const re = new RegExp(`${MARKER_BEGIN}[\\s\\S]*?${MARKER_END}\\n?`);
    existing = existing.replace(re, "");
  }
  const next = existing.trimEnd() + (existing.trim() ? "\n" : "") + lines.join("\n") + "\n";
  const write = spawnSync("crontab", ["-"], { input: next, encoding: "utf8" });
  if (write.status !== 0) {
    throw new CronfounderError({
      code: "E_CRONTAB",
      exit: EXIT.ERROR,
      problem: "crontab refused the new lines",
      cause: write.stderr?.slice(0, 200) ?? "unknown crontab error",
      fix: "install by hand: cronfounder cron print   then crontab -e",
    });
  }
  out.ok("cron:install", { installed: true, lines }, () => {
    out.print("clocks installed. The company now runs while you sleep:");
    out.print("  pulse 07:07 UTC · reflex every 10 min · season 08:17 UTC");
    out.print(`sensor credentials for cron go in ${store.company.dir}/.cronfounder/env (cron loads no shell profile)`);
    out.print("caveat: a sleeping laptop misses ticks; catch-up runs overdue work on the next tick. A tiny server is the honest home for a company.");
  });
}
