#!/usr/bin/env node
/**
 * cronfounder — a company harness.
 * Help is organized around the loop; every command supports --json (envelope
 * on stdout, progress on stderr) and the exit-code contract:
 *   0 ok · 1 error · 2 validation/usage · 3 gate-refused · 4 busy (retryable)
 */

// Suppress the node:sqlite ExperimentalWarning BEFORE anything imports it.
const defaultWarn = process.listeners("warning");
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name === "ExperimentalWarning" && /SQLite/i.test(w.message)) return;
  for (const l of defaultWarn) l.call(process, w);
});

const [maj, min] = process.versions.node.split(".").map(Number);
if (maj! < 22 || (maj === 22 && min! < 13)) {
  process.stderr.write(
    [
      `E_NODE_VERSION  cronfounder needs Node >= 22.13 (you have ${process.versions.node})`,
      `  cause: the embedded ledger uses node:sqlite, flag-free since 22.13`,
      `  fix:   install a current Node LTS — https://nodejs.org`,
    ].join("\n") + "\n",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const { Command } = await import("commander");
  const { withStore, outFor } = await import("./commands/helpers.js");

  const program = new Command();
  program
    .name("cronfounder")
    .description(
      [
        "a company harness: sensors write reality, a journal remembers, gates protect",
        "your principal, and growth becomes a loop.",
        "",
        "the loop: sense → plan → strategize → resolve (fund) → build → resolve",
        "(release) → push → watch → verdict → better bets. forever.",
        "",
        "first time?   cronfounder init my-co --demo     (60s, no keys, real loop)",
        "agents: every command takes --json; exit codes 0/1/2/3/4 are the contract.",
      ].join("\n"),
    )
    .version("0.1.0")
    .option("--json", "machine envelope on stdout, progress on stderr", false)
    .option("--quiet", "suppress progress output", false)
    .option("--company <dir>", "company directory (default: walk up from cwd; env: CRONFOUNDER_DIR)")
    .option("--cron", "scheduled invocation: lock contention exits 0 silently", false)
    .option("--runtime <adapter>", "override runtime adapter for this run (claude|stub|none)")
    .configureHelp({ sortSubcommands: false })
    .showSuggestionAfterError(true)
    .showHelpAfterError("(the loop, the commands, the contract: cronfounder --help)")
    // usage mistakes exit 2 per the contract, not commander's default 1
    // (exitOverride only fires on commander's own errors; 0 = help/version display)
    .exitOverride((err) => process.exit(err.exitCode === 0 ? 0 : 2));

  const g = () => {
    const o = program.opts();
    return { json: Boolean(o.json), quiet: Boolean(o.quiet), company: o.company as string | undefined, cron: Boolean(o.cron), runtime: o.runtime as string | undefined };
  };

  // ---- Start
  program
    .command("init [dir]")
    .description("scaffold a company and run onboarding (resumable; ends at the first funding card)")
    .option("--demo", "keyless demo: mock channel + stub runtime → funding card in ~60s", false)
    .option("--yes", "never prompt (agent mode); skipped questions become inbox cards", false)
    .option("--force", "allow scaffolding into a non-empty, non-company directory", false)
    .option("--url <url>", "website to ground doctrine in (onboarding reads before asking)")
    .option("--repo <owner/name>", "GitHub repo: doctrine artifact + a stars metric")
    .action(async (dir: string | undefined, opts: Record<string, unknown>) => {
      const { initCommand } = await import("./commands/init.js");
      const go = g();
      await initCommand(dir, {
        demo: Boolean(opts.demo),
        yes: Boolean(opts.yes),
        force: Boolean(opts.force),
        url: opts.url as string | undefined,
        repo: opts.repo as string | undefined,
        json: go.json,
        quiet: go.quiet,
        runtime: go.runtime,
      });
    });

  program
    .command("doctor")
    .description("check everything that silently kills the loop (node, runtime auth, credentials, clocks)")
    .action(async () => {
      const { doctorCommand } = await import("./commands/doctor.js");
      await withStore(g(), "read", "doctor", async (store, out) => doctorCommand(store, out));
    });

  // ---- Observe
  program
    .command("sense")
    .description("run every sensor: the only writer of reality (invariant I); no model calls")
    .action(async () => {
      const { senseCommand } = await import("./commands/sense.js");
      await withStore(g(), "mutate", "sense", async (store, out) => senseCommand(store, out));
    });

  program
    .command("plan")
    .description("diff spec vs status → gap report (deterministic); green-lane check; planner narrates if a runtime exists")
    .action(async () => {
      const { planCommand } = await import("./commands/plan.js");
      await withStore(g(), "mutate", "plan", async (store, out) => planCommand(store, out, { runtime: g().runtime }));
    });

  // ---- Decide
  program
    .command("board")
    .description("the hypothesis pipeline: needs-funding → running → blocked → verdicts (+ static HTML)")
    .action(async () => {
      const { boardCommand } = await import("./commands/views.js");
      await withStore(g(), "read", "board", async (store, out) => boardCommand(store, out));
    });

  program
    .command("inbox")
    .description("what needs a human — schema'd cards, each with its exact resolve command")
    .action(async () => {
      const { inboxCommand } = await import("./commands/views.js");
      await withStore(g(), "read", "inbox", async (store, out) => inboxCommand(store, out));
    });

  const resolveAction = (defaults: { approve?: boolean }) =>
    async (id: string, opts: Record<string, unknown>) => {
      const { resolveCommand } = await import("./commands/resolve.js");
      await withStore(g(), "mutate", "resolve", async (store, out) =>
        resolveCommand(store, out, id, {
          approve: Boolean(opts.approve) || (defaults.approve === true && !opts.reject && !opts.done && opts.choice === undefined),
          reject: Boolean(opts.reject),
          done: Boolean(opts.done),
          choice: opts.choice as string | undefined,
          reason: opts.reason as string | undefined,
          as: opts.as as string | undefined,
        }),
      );
    };

  program
    .command("resolve <request-id>")
    .description("resolve an inbox card: --approve | --choice <key> | --reject [--reason] | --done")
    .option("--approve", "fund the recommended bet / release the content")
    .option("--reject", "refuse it (records why; refusals are knowledge too)")
    .option("--done", "the card's steps are complete (core re-checks reality)")
    .option("--choice <key>", "fund a specific bet / answer a decide card")
    .option("--reason <text>", "reason recorded in the journal")
    .option("--as <actor>", "attribution for delegated approval (e.g. agent:opus-operator)")
    .action(resolveAction({}));

  program
    .command("approve <request-id>")
    .description("alias of `resolve --approve` (approval is ignition: funding compiles projects immediately)")
    .option("--choice <key>", "fund a specific bet instead of the recommended one")
    .option("--reject", "refuse instead (same as resolve --reject)")
    .option("--reason <text>", "reason recorded in the journal")
    .option("--as <actor>", "attribution for delegated approval")
    .action(resolveAction({ approve: true }));

  // ---- Execute
  program
    .command("strategize <metric>")
    .description("one naked gap → 3-7 priced, falsifiable bets + one funding card (idempotent per gap)")
    .option("--dry-run", "write the prompt + expected outputs; you think, then: cronfounder run import <run-id>")
    .action(async (metric: string, opts: Record<string, unknown>) => {
      const { strategizeCommand } = await import("./commands/strategize.js");
      await withStore(g(), "mutate", "strategize", async (store, out) =>
        strategizeCommand(store, out, metric, { runtime: g().runtime, dryRun: Boolean(opts.dryRun) }),
      );
    });

  program
    .command("build")
    .description("run the bound builder per project; drafts stop at the gate as approve_content cards")
    .option("--dry-run", "prepare builder run bundles instead of invoking the runtime")
    .action(async (opts: Record<string, unknown>) => {
      const { buildCommand } = await import("./commands/build.js");
      await withStore(g(), "mutate", "build", async (store, out) =>
        buildCommand(store, out, { runtime: g().runtime, dryRun: Boolean(opts.dryRun) }),
      );
    });

  program
    .command("push [content-id]")
    .description("publish approved content (default: all approved); opens a watch window; uncertain deliveries never auto-retry")
    .action(async (contentId: string | undefined) => {
      const { pushCommand } = await import("./commands/push.js");
      await withStore(g(), "mutate", "push", async (store, out) => pushCommand(store, out, contentId));
    });

  // ---- Review
  program
    .command("watch")
    .description("watchdog: evaluate tripwires on open windows; pause + page on harm; judges harm only, never success")
    .action(async () => {
      const { watchCommand } = await import("./commands/watch.js");
      await withStore(g(), "mutate", "watch", async (store, out) => watchCommand(store, out));
    });

  program
    .command("verdict")
    .description("season clock: compute every overdue verdict from sensor history alone (invariant IX)")
    .action(async () => {
      const { verdictCommand } = await import("./commands/verdict.js");
      await withStore(g(), "mutate", "verdict", async (store, out) => verdictCommand(store, out, { runtime: g().runtime }));
    });

  // ---- Maintain
  program
    .command("rebuild")
    .description("reconstruct company.db from files + journal (invariant V, executable)")
    .action(async () => {
      const { rebuildCommand } = await import("./commands/rebuild.js");
      await withStore(g(), "mutate", "rebuild", async (store, out) => rebuildCommand(store, out));
    });

  const runCmd = program.command("run").description("dry-run bundles: list them, import their staged artifacts");
  runCmd
    .command("list")
    .description("list run bundles under .cronfounder/runs/")
    .action(async () => {
      const { runListCommand } = await import("./commands/run.js");
      await withStore(g(), "read", "run:list", async (store, out) => runListCommand(store, out));
    });
  runCmd
    .command("import <run-id>")
    .description("validate + import staged artifacts through the same pipeline as a live runtime run")
    .action(async (runId: string) => {
      const { runImportCommand } = await import("./commands/run.js");
      await withStore(g(), "mutate", "run:import", async (store, out) => runImportCommand(store, out, runId));
    });

  const cronCmd = program.command("cron").description("the three clocks (pulse, reflex, season) as crontab lines");
  const cronDesc: Record<string, string> = {
    print: "print the crontab lines (never installs silently)",
    install: "install/update the lines in your crontab",
    status: "are the clocks installed?",
    uninstall: "remove the cronfounder lines from your crontab",
  };
  for (const sub of ["print", "install", "status", "uninstall"] as const) {
    cronCmd
      .command(sub)
      .description(cronDesc[sub]!)
      .option("--yes", "do not prompt (agent mode)")
      .action(async (opts: Record<string, unknown>) => {
        const { cronCommand } = await import("./commands/cron.js");
        await withStore(g(), "read", `cron:${sub}`, async (store, out) => cronCommand(store, out, sub, Boolean(opts.yes)));
      });
  }

  program
    .command("ontology")
    .description("print the machine appendix (the ontology as JSON) — offline agent bootstrap")
    .action(async () => {
      const { ontologyCommand } = await import("./commands/ontology.js");
      const out = outFor(g());
      ontologyCommand(out);
    });

  program.addHelpText(
    "after",
    [
      "",
      "the full first loop, keyless:",
      "  cronfounder init demo-co --demo && cd demo-co",
      "  cronfounder inbox                         # the funding card is waiting",
      "  cronfounder resolve R-1 --approve         # approval is ignition",
      "  cronfounder build && cronfounder inbox    # drafts arrive at the gate",
      "",
      "docs: docs/quickstart.md · agents: docs/operating.md · errors: docs/errors.md",
    ].join("\n"),
  );

  await program.parseAsync(process.argv);
}

main().catch((e) => {
  process.stderr.write(`E_UNEXPECTED  ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
