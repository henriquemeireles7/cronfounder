/**
 * doctor — every check: {name, ok, detail, fix}. Verifies the things that
 * silently kill the loop: node floor, config, db, events integrity, runtime
 * binary AND auth, credential refs (metrics + channels), driver mappings,
 * cron installation. Exit 0 if all pass, 1 otherwise.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readAllEvents } from "../core/events.js";
import { channelReadiness } from "../core/readiness.js";
import type { Store } from "../core/store.js";
import type { Out } from "../output.js";
import { sem } from "../output.js";
import { EXIT } from "../errors.js";
import { getDriver } from "../channels/driver.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export async function runDoctor(store: Store, out: Out): Promise<Check[]> {
  const checks: Check[] = [];
  const db = store.ledger.db;
  const cfg = store.company.config;

  const [maj, min] = process.versions.node.split(".").map(Number);
  checks.push({
    name: "node",
    ok: maj! > 22 || (maj === 22 && min! >= 13),
    detail: `v${process.versions.node}`,
    fix: "cronfounder needs Node >= 22.13 (node:sqlite without flags) — https://nodejs.org",
  });
  checks.push({ name: "company", ok: true, detail: store.company.dir });
  const schemaRow = db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get() as { value: string };
  checks.push({ name: "ledger", ok: true, detail: `schema v${schemaRow.value}, WAL, ${store.company.paths.db}` });

  const { events, truncated } = await readAllEvents(store.company.paths.events);
  checks.push({
    name: "events",
    ok: truncated.length === 0,
    detail: `${events.length} events${truncated.length > 0 ? `, ${truncated.length} torn line(s): ${truncated.join(", ")}` : ""}`,
    fix: "torn tails are quarantined automatically; mid-file corruption deserves a look before you trust history",
  });

  // machines seen in events (single-active-machine topology)
  const machines = [...new Set(events.map((e) => e.machine))];
  checks.push({
    name: "writers",
    ok: machines.length <= 1,
    detail: machines.join(", ") || "none yet",
    fix: "events show multiple machines — cronfounder supports one active machine per company; consolidate before running clocks on both",
  });

  // runtime
  if (cfg.runtime.adapter === "claude") {
    const cmd = cfg.runtime.command ?? "claude";
    const version = spawnSync(cmd, ["--version"], { encoding: "utf8", timeout: 15_000 });
    if (version.status !== 0) {
      checks.push({
        name: "runtime",
        ok: false,
        detail: `"${cmd}" not runnable (${version.error?.message ?? version.stderr?.slice(0, 100) ?? "non-zero exit"})`,
        fix: 'install Claude Code, or set runtime.adapter to "stub"/"none", or use --dry-run + run import',
      });
    } else {
      checks.push({ name: "runtime", ok: true, detail: `${cmd} ${String(version.stdout).trim()}` });
      const auth = spawnSync(cmd, ["-p", "reply with exactly: ok", "--output-format", "json", "--max-turns", "1"], {
        encoding: "utf8",
        timeout: 60_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      checks.push({
        name: "runtime-auth",
        ok: auth.status === 0,
        detail: auth.status === 0 ? "authenticated (test invocation succeeded)" : `test invocation failed: ${(auth.stderr || auth.stdout || "").slice(0, 120)}`,
        fix: "run `claude` once interactively to log in; under cron, auth must come from the environment",
      });
    }
  } else {
    checks.push({ name: "runtime", ok: true, detail: `adapter: ${cfg.runtime.adapter} (no external runtime needed)` });
  }

  // sensors' credential refs
  const metrics = db.prepare("SELECT name, sensor_json FROM metrics").all() as Array<{ name: string; sensor_json: string }>;
  for (const m of metrics) {
    const sensor = JSON.parse(m.sensor_json) as { type: string; credential_ref?: string };
    if (sensor.credential_ref) {
      const ok = Boolean(process.env[sensor.credential_ref]);
      checks.push({
        name: `sensor:${m.name}`,
        ok,
        detail: ok ? `$${sensor.credential_ref} resolves` : `$${sensor.credential_ref} NOT set in this environment`,
        fix: `export ${sensor.credential_ref}=… (and put it in the env file your cron sources — cron does not load your shell profile)`,
      });
    } else {
      checks.push({ name: `sensor:${m.name}`, ok: true, detail: `${sensor.type} (no credential needed)` });
    }
  }

  // channels
  const channels = db.prepare("SELECT * FROM channels").all() as any[];
  for (const c of channels) {
    const r = channelReadiness(store, c.id);
    const probe = r.ready && c.kind !== "mock" ? await getDriver(store.company, c).probe() : null;
    const ready = r.ready && (probe?.ok ?? true);
    const missing = [...r.missing, ...(probe?.missing ?? [])];
    checks.push({
      name: `channel:${c.id}`,
      ok: ready,
      detail: ready ? "ready (driver probe passed)" : missing.join("; "),
      fix: ready ? undefined : `see channels/${c.id}/setup.md and docs/commands.md#drivers`,
    });
  }

  // cron
  const crontab = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  const installed = crontab.status === 0 && String(crontab.stdout).includes("cronfounder");
  checks.push({
    name: "clocks",
    ok: installed,
    detail: installed ? "cron lines installed" : "no cronfounder lines in crontab — the loop only runs when you run it",
    fix: "install the three clocks: cronfounder cron install   (or print them: cronfounder cron print)",
  });

  // templates present (packaging sanity)
  checks.push({
    name: "package",
    ok: existsSync(store.company.paths.agentMd),
    detail: existsSync(store.company.paths.agentMd) ? "AGENT.md present" : "AGENT.md missing",
    fix: "re-scaffold missing files: compare against templates/company in the cronfounder package",
  });

  return checks;
}

export async function doctorCommand(store: Store, out: Out): Promise<void> {
  const checks = await runDoctor(store, out);
  const failed = checks.filter((c) => !c.ok);
  if (out.json) {
    if (failed.length > 0) {
      process.stdout.write(JSON.stringify({ v: 1, ok: false, code: EXIT.ERROR, action: "doctor", data: { checks } }) + "\n");
      process.exit(EXIT.ERROR);
    }
    out.ok("doctor", { checks });
  }
  for (const c of checks) {
    out.print(`${c.ok ? sem.status("✓") : sem.bet("✗")} ${c.name.padEnd(18)} ${c.detail}${!c.ok && c.fix ? `\n  ${sem.dim("fix: " + c.fix)}` : ""}`);
  }
  out.print("");
  out.print(failed.length === 0 ? sem.status("all checks pass — the loop can close") : sem.bet(`${failed.length} check(s) failing`));
  process.exit(failed.length === 0 ? EXIT.OK : EXIT.ERROR);
}
