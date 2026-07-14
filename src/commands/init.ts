/**
 * init — distribution is a terminal command, and onboarding is the first
 * execution of the loop, compressed. Phase-checkpointed and RESUMABLE: run it
 * again after a failure and it continues where it stopped (--force is only
 * for non-cronfounder directories, never for repairing your own company).
 *
 * The final act, when the loop closes: printing the first funding card.
 */
import { cp, mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CronfounderError, EXIT } from "../errors.js";
import { isCompanyDir, loadCompany } from "../core/company.js";
import { Store } from "../core/store.js";
import { serializeFm, atomicWrite } from "../core/fm.js";
import { fileRequest } from "../core/inbox.js";
import { computeInbox } from "../render/viewmodel.js";
import { renderInboxTerminal } from "../render/terminal.js";
import { Out, sem } from "../output.js";
import { iso, now, today } from "../ids.js";
import { ask } from "./helpers.js";
import { runSense } from "./sense.js";
import { runPlan } from "./plan.js";
import { strategizeMetric } from "./strategize.js";
import { selectAdapter, prepareRun } from "../runtime/adapter.js";
import { HATS } from "../runtime/hats.js";
import { onboardingPrompt } from "../runtime/prompts.js";
import { cronLines } from "./cron.js";

export interface InitOpts {
  demo: boolean;
  yes: boolean;
  force: boolean;
  url?: string;
  repo?: string;
  json: boolean;
  quiet: boolean;
  runtime?: string;
}

function templatesDir(): string {
  // dist/commands/init.js -> ../../templates/company
  return fileURLToPath(new URL("../../templates/company", import.meta.url));
}

function checkpoint(out: Out, phase: string, detail: string): void {
  out.progress(`${sem.status("✓")} ${phase.padEnd(12)} ${detail}`);
}

export async function initCommand(dirArg: string | undefined, opts: InitOpts): Promise<void> {
  const out = new Out({ json: opts.json, quiet: opts.quiet });
  try {
    const dir = path.resolve(dirArg ?? ".");
    const resuming = isCompanyDir(dir);

    // ---- phase 1: scaffold -------------------------------------------------
    if (!resuming) {
      if (existsSync(dir) && (await readdir(dir)).filter((f) => f !== ".git" && f !== ".DS_Store").length > 0 && !opts.force) {
        throw new CronfounderError({
          code: "E_DIR_NOT_EMPTY",
          exit: EXIT.VALIDATION,
          problem: `${dir} is not empty and is not a cronfounder company`,
          cause: "init refuses to scaffold over unknown files",
          fix: "point init at a new directory (cronfounder init my-co), or pass --force to scaffold anyway",
        });
      }
      await mkdir(dir, { recursive: true });
      await cp(templatesDir(), dir, { recursive: true });
      await rename(path.join(dir, "gitignore"), path.join(dir, ".gitignore"));
      for (const sub of ["metrics", "hypotheses", "content", "inbox", "journal/events", ".cronfounder"]) {
        await mkdir(path.join(dir, sub), { recursive: true });
      }
      const hasClaudeCli = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 10_000 }).status === 0;
      const adapter = opts.demo ? "stub" : hasClaudeCli ? "claude" : "none";
      const config = {
        v: 1,
        company: path.basename(dir),
        machine_id: `${process.env.USER ?? "user"}-${randomBytes(3).toString("hex")}`,
        currency: "usd",
        freshness_hours: 48,
        runtime: { adapter, timeout_s: 600, max_turns: 30 },
        drivers: {},
      };
      await mkdir(path.join(dir, ".cronfounder"), { recursive: true });
      await writeFile(path.join(dir, ".cronfounder", "config.json"), JSON.stringify(config, null, 2) + "\n", "utf8");
      if (spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0 && !existsSync(path.join(dir, ".git"))) {
        spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
      }
      checkpoint(out, "scaffold", `${dir} (runtime: ${adapter})`);
    } else {
      checkpoint(out, "scaffold", `existing company found — resuming onboarding (init is resumable, never destructive)`);
    }

    const company = await loadCompany(dir);
    const store = await Store.open(company, "mutate", { command: "init" });
    try {
      if (!resuming) {
        await store.append([store.event("human", "company_initialized", { company: company.config.company })]);
      }

      // ---- phase 2: doctrine ----------------------------------------------
      const identityFm = await readFile(company.paths.identity, "utf8").catch(() => "");
      const identityIsDraft = /draft:\s*true/.test(identityFm);
      if (identityIsDraft) {
        if (opts.demo) {
          await atomicWrite(
            company.paths.identity,
            serializeFm(
              { draft: false },
              [
                "# Identity (demo fixture)",
                "",
                "- **ICP:** developers evaluating cronfounder with the mock channel",
                "- **Problem:** growth advice doesn't compile; the loop is open and slow",
                "- **Solution:** a company harness that closes it",
                "- **Offer & pricing:** open source, MIT",
                "- **Positioning:** to an agent what Kubernetes is to a container",
                "- **Voice:** concrete, honest about uncertainty, allergic to hype",
              ].join("\n"),
            ),
          );
          checkpoint(out, "doctrine", "demo fixture written (trusted, no web content)");
        } else {
          const adapter = selectAdapter(company, opts.runtime);
          if (adapter && (opts.url || opts.repo)) {
            out.progress(`onboarding (${adapter.name}) reading your artifacts and drafting doctrine…`);
            const hat = HATS.onboarding;
            const bundle = await prepareRun(company, hat, "", ["identity.md draft"]);
            const prompt = await onboardingPrompt(company, { url: opts.url, repo: opts.repo }, bundle.staging_dir);
            await writeFile(bundle.prompt_file, prompt, "utf8");
            try {
              await adapter.invoke(bundle, prompt, company.config.runtime.timeout_s);
              const draftPath = path.join(bundle.staging_dir, "identity.md");
              if (existsSync(draftPath)) {
                const draft = await readFile(draftPath, "utf8");
                if (opts.yes || !process.stdin.isTTY) {
                  // non-interactive: the draft is NOT canon until a human confirms (trust boundary)
                  await atomicWrite(path.join(company.dir, "doctrine", "identity.draft.md"), draft);
                  await fileRequest(store, "agent:onboarding", "decide", {
                    what: "review the drafted doctrine before it becomes canon",
                    why: "doctrine steers every actor on every run; web-derived drafts are untrusted until you confirm (prompt-injection boundary)",
                    steps: [
                      `read doctrine/identity.draft.md`,
                      `if right: replace doctrine/identity.md with it (and delete the draft)`,
                      `then resolve this card`,
                    ],
                    blocking: "doctrine-grounded strategy quality (placeholders produce generic bets)",
                    choices: [{ key: "reviewed", label: "I reviewed and applied/discarded the draft" }],
                  } as any);
                  checkpoint(out, "doctrine", "draft written to doctrine/identity.draft.md — review card filed (never auto-canon)");
                } else {
                  out.print("\n— drafted doctrine (from your artifacts) —\n");
                  out.print(draft);
                  const answer = await ask("\napply this draft to doctrine/identity.md? [y/N] ", "--yes");
                  if (answer.toLowerCase() === "y") {
                    await atomicWrite(company.paths.identity, draft.replace(/draft:\s*true/, "draft: false"));
                    checkpoint(out, "doctrine", "draft confirmed and applied — correct it further any time; files are canon");
                  } else {
                    checkpoint(out, "doctrine", "draft declined — placeholders remain; edit doctrine/identity.md by hand");
                  }
                }
              }
            } catch (e) {
              out.progress(`onboarding draft failed (${e instanceof Error ? e.message.split("\n")[0] : e}) — placeholders remain`);
            }
          } else {
            checkpoint(
              out,
              "doctrine",
              adapter
                ? "no artifacts given (--url/--repo) — placeholders remain; edit doctrine/identity.md (10 minutes there sharpens every bet)"
                : "no runtime — fill doctrine/identity.md by hand, or re-run init after installing Claude Code",
            );
          }
        }
      } else {
        checkpoint(out, "doctrine", "already present");
      }

      // ---- phase 3: first metric + spec -------------------------------------
      const haveMetrics = store.ledger.db.prepare("SELECT COUNT(*) c FROM metrics").get() as { c: number };
      if (haveMetrics.c === 0) {
        if (opts.demo) {
          await mkdir(company.paths.mockState, { recursive: true });
          await writeFile(path.join(company.paths.mockState, "mock.json"), JSON.stringify({ value: 12, posts: [], signals: [] }, null, 2), "utf8");
          const deadline = iso(new Date(now().getTime() + 30 * 86400_000)).slice(0, 10);
          await atomicWrite(
            path.join(company.paths.metrics, "demo_signups.md"),
            serializeFm(
              {
                name: "demo_signups",
                parent: null,
                unit: "signups",
                direction: "increase",
                sensor: { type: "mock", channel: "mock" },
                spec: { target: 100, deadline, set_by: "demo", set_at: today(), baseline_value: null },
                status: null,
              },
              "# demo_signups\n\nA simulated number backed by the mock channel — edit .cronfounder/mock/mock.json to move it. Every mechanism you see (gaps, bets, gates, verdicts) is the real machinery.\n",
            ),
          );
          checkpoint(out, "metric", "demo_signups: 12 → 100 in 30 days (mock sensor)");
        } else if (opts.repo) {
          const deadline = iso(new Date(now().getTime() + 90 * 86400_000)).slice(0, 10);
          await atomicWrite(
            path.join(company.paths.metrics, "github_stars.md"),
            serializeFm(
              {
                name: "github_stars",
                parent: null,
                unit: "stars",
                direction: "increase",
                sensor: { type: "github_stars", repo: opts.repo },
                spec: { target: 500, deadline, set_by: "init", set_at: today(), baseline_value: null },
                status: null,
              },
              `# github_stars\n\nDevelopers voting that ${opts.repo} deserves attention. Public API, no credential (GITHUB_TOKEN raises rate limits). Edit spec.target/deadline to your real ambition — this default (500 by ${deadline}) is a starting point, not a strategy.\n`,
            ),
          );
          checkpoint(out, "metric", `github_stars for ${opts.repo} (target 500 by ${deadline} — edit to taste)`);
        } else if (!opts.yes && process.stdin.isTTY) {
          const repo = await ask("GitHub repo for a stars metric (owner/name, enter to skip): ", "--repo <owner/name>");
          if (repo) {
            const target = Number((await ask("target stars [500]: ", "--yes")) || "500");
            const deadline = (await ask(`deadline [${iso(new Date(now().getTime() + 90 * 86400_000)).slice(0, 10)}]: `, "--yes")) || iso(new Date(now().getTime() + 90 * 86400_000)).slice(0, 10);
            await atomicWrite(
              path.join(company.paths.metrics, "github_stars.md"),
              serializeFm(
                {
                  name: "github_stars",
                  parent: null,
                  unit: "stars",
                  direction: "increase",
                  sensor: { type: "github_stars", repo },
                  spec: { target, deadline, set_by: "human", set_at: today(), baseline_value: null },
                  status: null,
                },
                `# github_stars\n\nDevelopers voting that ${repo} deserves attention.\n`,
              ),
            );
            checkpoint(out, "metric", `github_stars: ${target} by ${deadline}`);
          } else {
            checkpoint(out, "metric", "skipped — add one later (see metrics/EXAMPLE-github_stars.md.txt)");
          }
        } else {
          checkpoint(out, "metric", "none yet — add one: copy metrics/EXAMPLE-github_stars.md.txt to metrics/github_stars.md and edit");
        }
      } else {
        checkpoint(out, "metric", `${haveMetrics.c} metric(s) present`);
      }

      // rescan so new files register
      const { scanDocuments } = await import("../core/scan.js");
      await scanDocuments(store);

      // ---- phase 4: first sense ---------------------------------------------
      const metricsNow = store.ledger.db.prepare("SELECT COUNT(*) c FROM metrics").get() as { c: number };
      if (metricsNow.c > 0) {
        const senseRes = await runSense(store, out);
        checkpoint(out, "sense", `${senseRes.readings.length} reading(s) — reality is in`);
      }

      // ---- phase 5: plan ------------------------------------------------------
      const { gap } = await runPlan(store, out, { runtime: opts.runtime, dryRun: true });
      const naked = gap.rows.filter((r) => r.classification === "naked");
      checkpoint(out, "plan", `${gap.rows.length} metric(s); ${naked.length} naked gap(s)`);

      // ---- phase 6: strategize the first naked gap ----------------------------
      let fundingCard: number | null = null;
      if (naked.length > 0) {
        const adapter = selectAdapter(company, opts.runtime);
        if (adapter) {
          const res = await strategizeMetric(store, out, naked[0]!.metric, { runtime: opts.runtime });
          if (!("dry_run" in res)) {
            fundingCard = res.funding_card;
            checkpoint(out, "strategize", `${res.registered.length} bet(s) on ${naked[0]!.metric}`);
          }
        } else {
          checkpoint(
            out,
            "strategize",
            `skipped (no runtime) — three ways to the first bets: install Claude Code · cronfounder strategize ${naked[0]!.metric} --dry-run · try the demo: cronfounder init demo-co --demo`,
          );
        }
      }

      // ---- final: the magic moment --------------------------------------------
      const inbox = computeInbox(store);
      const cron = cronLines(company.dir);
      if (opts.json) {
        out.ok("init", {
          dir: company.dir,
          resumed: resuming,
          funding_card: fundingCard !== null ? `R-${fundingCard}` : null,
          inbox,
          cron: cron.lines,
        });
      }
      out.print("");
      if (fundingCard !== null) {
        out.print(sem.bold("The loop just closed for the first time. One decision is waiting:"));
        out.print("");
        out.print(renderInboxTerminal(inbox));
      } else if (inbox.open.length > 0) {
        out.print(renderInboxTerminal(inbox));
      } else {
        out.print(sem.bold("Scaffold ready.") + " Next steps, in order:");
        out.print("  1. fill doctrine/identity.md (or re-run init with --url/--repo and a runtime)");
        out.print("  2. add a metric with a spec (metrics/EXAMPLE-github_stars.md.txt shows how)");
        out.print("  3. cronfounder sense && cronfounder plan");
        out.print("  4. cronfounder strategize <metric>");
      }
      out.print("");
      out.print(sem.dim("install the clocks so this runs while you sleep:  cronfounder cron install"));
      out.print(sem.dim("approvals arrive in:  cronfounder inbox   (and inbox/*.md, and .cronfounder/site/inbox.html)"));
      process.exit(0);
    } finally {
      store.close();
    }
  } catch (e) {
    out.fail(e, "init");
  }
}
