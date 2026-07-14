# Command reference

## The global contract

**Exit codes** (frozen):

| code | meaning |
|---|---|
| 0 | ok (including no-ops: "nothing was due") |
| 1 | error |
| 2 | validation / usage |
| 3 | gate refused — an invariant said no; the error names it. Relay, never work around. |
| 4 | busy / locked — retryable (another cronfounder command holds the company lock) |

**Output discipline**: stdout carries the result; stderr carries ALL progress, diagnostics, and color. Under `--json`, stdout carries exactly one envelope object:

```jsonc
// success
{ "v": 1, "ok": true,  "code": 0, "action": "<command>", "data": { ... } }
// no-op (nothing was due)
{ "v": 1, "ok": true,  "code": 0, "action": "<command>:noop", "data": { "reason": "..." } }
// failure
{ "v": 1, "ok": false, "code": 1|2|3|4, "action": "<command>",
  "error": { "code": "E_*", "invariant": "I..X (gate refusals only)",
             "problem": "...", "cause": "...", "fix": "...",
             "docs": "docs/errors.md#e-...", "retryable": false },
  "retryable": false }
```

Two documented deviations: `doctor --json` with failing checks emits `{v, ok:false, code:1, action:"doctor", data:{checks}}` (data, not error — the checks ARE the diagnosis), and `ontology` prints the raw ontology JSON with or without `--json` (that output is for machines either way).

**Global flags** (on every command):

| flag | effect |
|---|---|
| `--json` | machine envelope on stdout, progress on stderr |
| `--quiet` | suppress progress output |
| `--company <dir>` | company directory; default: walk up from cwd (like git) |
| `--cron` | scheduled invocation: lock contention exits 0 silently instead of 4 |
| `--runtime <adapter>` | override the runtime adapter for this run (`claude` \| `stub` \| `none`) |

**Environment variables**:

| var | effect |
|---|---|
| `CRONFOUNDER_DIR` | company directory (between `--company` and walk-up in precedence) |
| `CRONFOUNDER_RUNTIME` | runtime adapter override (between `--runtime` and config) |
| `CRONFOUNDER_NOW` | ISO timestamp that freezes the clock — tests, demos, agents simulating seasons |
| `GITHUB_TOKEN` | optional; raises the github_stars rate limit from 60 to 5000 req/hour |
| `NO_COLOR` | disables color |
| `CRONFOUNDER_GITHUB_API`, `CRONFOUNDER_STRIPE_API` | sensor API base overrides (test fixtures) |

**Interactive prompts never happen when stdin is not a TTY** — commands exit 2 (`E_NEEDS_TTY`) naming the exact flag to pass instead. A hidden prompt is a hung agent session.

Mutating commands take the per-company lock (`.cronfounder/lock`); read-only commands (`board`, `inbox`, `doctor`, `run list`, `cron`) don't and can never exit 4.

---

## init `[dir]`

Scaffold a company and run onboarding — the first execution of the loop, compressed. Resumable: run it again after a failure and it continues where it stopped; never destructive to an existing company.

| flag | effect |
|---|---|
| `--demo` | keyless demo: mock channel + stub runtime → funding card in ~60 s |
| `--yes` | never prompt (agent mode); skipped questions become inbox cards |
| `--force` | allow scaffolding into a non-empty, non-company directory |
| `--url <url>` | website to ground doctrine in (onboarding reads before asking) |
| `--repo <owner/name>` | GitHub repo: doctrine artifact + a stars metric |

- **Reads**: templates, your artifacts (via the onboarding hat, runtime permitting).
- **Writes**: the whole company scaffold (`doctrine/`, `metrics/`, `channels/`, `playbooks/`, `AGENT.md`, `.gitignore`, `.cronfounder/config.json`), git init, first events, and — when the loop closes — the first funding card.
- **Exit codes**: 0, 1, 2 (`E_DIR_NOT_EMPTY`, `E_NEEDS_TTY`).
- **JSON data**: `{dir, resumed, funding_card: "R-n"|null, inbox: InboxModel, cron: string[]}`.
- **Cost**: `--demo` ~30–60 s, 0 tokens, offline. Real with `--url`/`--repo` + runtime: 2–10 min, one onboarding run + one strategist run. Without a runtime: seconds, prints exact next steps.

## doctor

Every check that silently kills the loop: node floor, config, ledger schema, event-log integrity (torn lines), single-writer topology, runtime binary AND auth (one cheap 1-turn test invocation), every sensor credential ref, channel readiness (probed), cron installation, packaging sanity.

Checks have three states: `✓` passing, `✗` broken (fails the run), and `○` setup pending (`severity: "warn"` — an unconfigured channel or uninstalled clocks; nothing is broken, the loop still closes without them).

- **Reads**: everything. **Writes**: nothing. Read-only, no lock.
- **Exit codes**: 0 when nothing is broken (pending ○ checks don't fail), 1 otherwise. 2 (`E_NO_COMPANY`).
- **JSON data**: `{checks: [{name, ok, detail, fix?, severity?}]}` — emitted with `ok:false, code:1` only when a non-warn check fails.
- **Cost**: seconds; network only for the runtime auth probe (skipped unless adapter is `claude`).

## sense

Run every sensor. The only writer of reality (invariant I). No model calls. Failures are isolated per sensor — one broken sensor never blocks the others; 3 consecutive failures on one sensor file an inbox card (the system reports its own broken heartbeat).

- **Reads**: `metrics/*.md` sensor configs. **Writes**: `sensor_reading`/`sensor_failure` events, `status` mirror in each metric file, journal.
- **Exit codes**: 0 (including `sense:noop` when no metrics exist), 1, 2, 4.
- **JSON data**: `{readings: [{metric, value, measured_at}], failures: [{metric, error, code}]}`.
- **Cost**: seconds, 0 tokens. Network per real sensor (github/stripe); the mock sensor is local.

## plan

The diff. The core computes the entire gap model deterministically — classification (`naked | needs_decision | running | verdict_due | blocked | green | unknown`), direction-adjusted gap and gap %, 14-day trajectory, needed-per-day, freshness, blocker, and a `next_action` per metric. Runs the green-lane check (auto-activation within the constitution budget — default OFF). If a runtime exists, the planner hat adds one page of narration; failures to narrate never fail the plan.

- **Reads**: ledger. **Writes**: a `journal_note` gap report; activation events if the green lane fires.
- **Exit codes**: 0, 1, 2, 4.
- **JSON data**: `{gap: {v, generated_at, rows: [GapRow]}, narration: string|null, green_lane_activated: string[]}` where `GapRow = {metric, unit, direction, value, measured_at, freshness, target, deadline, gap, gap_pct, trajectory_per_day, needed_per_day, bet, classification, blocker, next_action}`.
- **Cost**: seconds + optional narration run (~1 min, small tokens). `--runtime none` skips narration.

## board

The hypothesis pipeline in four sections, never ranked across sections: ① needs funding (leverage-ranked within each gap) → ② running/measuring (by review date, "day X/Y · +N of claimed +M") → ③ blocked/paused (with the unblock action) → ④ recent verdicts. Also regenerates the static HTML snapshot.

- **Reads**: ledger. **Writes**: `.cronfounder/site/board.html` + `inbox.html` (best-effort; read-only fs is fine). Read-only, no lock.
- **Exit codes**: 0, 1, 2.
- **JSON data**: `{v, generated_at, needs_funding: [{metric, gap, bets: [BoardBet]}], running: [BoardBet], blocked: [BoardBet], recent_verdicts: [BoardBet]}`.
- **Cost**: instant, 0 tokens, offline.

## inbox

What needs a human — schema'd cards (`approve_hypothesis`, `approve_content`, `setup_channel`, `provide_credential`, `decide`), urgent pinned first, each with its exact resolve command. Mirrored as `inbox/R-*.md` files and static HTML.

- **Reads**: ledger. **Writes**: HTML snapshots (best-effort). Read-only, no lock.
- **Exit codes**: 0, 1, 2.
- **JSON data**: `{v, generated_at, open: [{id, kind, urgent, created_at, what, why, steps, blocking, choices, context, resolve_hint}], running_bets, next_review}`.
- **Cost**: instant, 0 tokens, offline.

## resolve `<request-id>` / approve `<request-id>`

The human gate, able to say every kind of no. `approve R-n` is the spec-fidelity alias for `resolve R-n --approve`.

| flag | applies to | effect |
|---|---|---|
| `--approve` | funding, content | fund the recommended bet / release the content |
| `--choice <key>` | funding, decide | fund a specific bet / answer a decide card |
| `--reject [--reason]` | funding, content | refuse: bet set → `disposition: rejected`; content → back to `draft` (reason recorded) |
| `--done` | setup_channel, provide_credential | the steps are complete; the core re-probes reality (`E_STILL_NOT_READY` if it disagrees) |
| `--as <actor>` | all | attribution for delegated approval, e.g. `--as agent:opus-operator` — recorded in events and journal |

Funding is ignition: the chosen bet activates (baseline frozen, `review_at` computed, projects + tasks compiled), and siblings are closed in the same decision. Exactly one mode flag is required (`E_RESOLVE_MODE`); cards resolve exactly once (`E_ALREADY_RESOLVED`).

- **Exit codes**: 0, 1, 2 (`E_BAD_ID`, `E_WRONG_ID_KIND`, `E_BAD_CHOICE`, ...), 3 (`E_WIP_LIMIT`, `E_NOT_READY`, `E_NO_BASELINE`, `E_BASELINE_STALE`, `E_ILLEGAL_TRANSITION`), 4.
- **JSON data**: funding → `{request, funded, review_at, projects, tasks}`; reject → `{request, resolution, bets}`; content → `{request, content, resolution}`; setup → `{request, resolution, channel?, unblocked?}`; decide → `{request, choice}`.
- **Cost**: instant, 0 tokens, offline.

## strategize `<metric>`

One naked gap in, 3–7 registered bets out, one funding card filed. Idempotent per gap: refuses while an unresolved bet set exists (`E_BETS_PENDING`), while a bet is live (`E_METRIC_BUSY`, exit 3, invariant VIII), when the metric passes (`E_NO_GAP`), or when there is no truth to plan on (`E_NO_TRUTH`). Schema-invalid bets are rejected with reasons; bets on unready channels register as `blocked` with setup cards queued.

| flag | effect |
|---|---|
| `--dry-run` | write the prompt + expected outputs; you think, then `cronfounder run import <run-id>` |

- **Exit codes**: 0, 1 (`E_RUNTIME_*`), 2, 3, 4.
- **JSON data**: `{registered: [H-id], rejected: [{file, reason}], funding_card: number|null, blocked: [H-id]}`; dry-run → the run bundle `{run_id, hat, run_dir, staging_dir, prompt_file, allowed_tools, expected_artifacts}` under action `strategize:dry-run`.
- **Cost**: 5–15 min, ≈ one long research session of tokens. `--dry-run`: instant, 0 tokens. Needs a runtime (or `--dry-run`).

## build

Run the bound builder for each open task of each funded project. Tasks claim under the company lock; claims left by a dead run are reset at the start of the next build. Every draft is validated (schema, provenance, acceptance) and lands at `pending_approval` with an `approve_content` card — drafts stop at the gate (invariant III). Channel-setup projects file their setup card and complete (the card IS the deliverable — channel setup is human work by definition). When a bet's last project finishes, it moves `active → measuring`.

| flag | effect |
|---|---|
| `--dry-run` | prepare builder run bundles instead of invoking the runtime |

- **Exit codes**: 0 (including `build:noop` when no tasks are open), 1, 2, 3, 4.
- **JSON data**: `{drafted: [C-id], cards: [number], dry_runs: [RunBundle], nothing_due: bool}`.
- **Cost**: minutes + tokens ≈ one drafting session per project. `--dry-run`: instant, 0 tokens. Needs a runtime (or `--dry-run`).

## push `[content-id]`

Publish approved content (default: all approved). The crash-consistent protocol: `push_intent` event → driver call (with idempotency key) → `publication` event. Cadence limits are enforced per channel per day (over-limit items are deferred, not failed). Every successful push opens a 60-minute watch window. An **uncertain delivery is never auto-retried**: it files an urgent decide card, and re-running push refuses (`E_PUSH_PENDING`, exit 3) while the intent is unresolved — re-pushing blindly could double-post.

- **Exit codes**: 0 (including `push:noop`), 1, 2, 3 (`E_GATE_UNAPPROVED`, `E_PUSH_PENDING`), 4.
- **JSON data**: `{results: [{content, channel, external_id?, status: "published"|"uncertain"|"refused", detail?}]}`.
- **Cost**: seconds, 0 tokens. Network via the channel driver (mock is local).

## watch

The watchdog (reflex clock). Judges harm only, never success: evaluates tripwires on open windows (pulling signals via the channel driver, deduped by remote id), pauses the hypothesis and pages the human (urgent card) on a trip, closes expired windows clean. Also reconciles orphaned push intents (crash between intent and outcome, >5 min old) into decide cards, and re-escalates pauses stale for over 7 days. No-ops fast when nothing is open — cron-safe.

- **Exit codes**: 0 (including `watch:noop`), 1, 2, 4.
- **JSON data**: `{evaluated, tripped: [{window, hypothesis, signal, observed, threshold}], closed: [window], orphan_intents: [intent], nothing_due}`.
- **Cost**: seconds, 0 tokens. Network only when open windows have tripwires.

## verdict

The season clock. Processes EVERY overdue `review_at` (catch-up after downtime), computes each verdict from sensor history alone (invariant IX — see [concepts.md#verdicts](concepts.md#verdicts)), freezes the readings in the event, updates playbook track records, and files decide cards for inconclusive outcomes (extend once / close). Afterwards, if a runtime is configured, re-strategizes metrics that are red and naked — that part costs a strategist run each.

- **Exit codes**: 0 (including `verdict:noop` — "verdicts arrive on schedule, never early"), 1, 2, 4.
- **JSON data**: `{decided: [{hypothesis, result, delta}], inconclusive: [{hypothesis, reason, card}], restrategized: [metric], nothing_due}`.
- **Cost**: seconds, 0 tokens for the verdicts themselves; optional re-strategize runs when a runtime is configured.

## rebuild

Invariant V, executable. Reconstructs `company.db` from files + journal under the exclusive lock: drop projections → scan documents (files are canon) → replay every event shard (facts are events) → repair machine-owned file mirrors → checkpoint WAL. Torn event lines (crash mid-append) are quarantined and reported, never fatal.

- **Exit codes**: 0, 1, 2, 4.
- **JSON data**: `{events_replayed, documents, mirrors_repaired: [path], torn_lines}`.
- **Cost**: seconds, 0 tokens, offline.

## run list / run import `<run-id>`

The dry-run loop's second half — the agent-native interface. `run list` shows the bundles under `.cronfounder/runs/`. `run import` validates and imports the staged artifacts through the IDENTICAL pipeline a live runtime run uses, then finishes the originating command's work (registers + scores + gates bets for a strategist run; gates drafts and files cards for a build task). Imports are exactly-once: staging is cleaned on success, and a second import fails with `E_ALREADY_IMPORTED`.

- **Exit codes**: `list` 0, 1, 2. `import` 0, 1, 2 (`E_NOT_FOUND`, `E_ALREADY_IMPORTED`, `E_NO_METRIC`), 3, 4.
- **JSON data**: `list` → `{runs: [{run_id, hat, command?, imported?}]}`; `import` → the finishing command's shape (strategize result, build task result, or a generic `{imported, rejected, narration}` report).
- **Cost**: instant, 0 tokens, offline.

## cron print | install | status | uninstall

The three clocks as crontab lines. `print` never installs; `install` asks first (or `--yes`); `status` reports; `uninstall` removes exactly the marker-delimited cronfounder block (a no-op if none is installed). Lines use absolute node + cli paths, source `<company>/.cronfounder/env` (cron loads no shell profile), and run every command with `--company <dir> --cron --quiet` so lock contention exits 0 silently. Install refuses binaries inside npx/temp caches (`E_EPHEMERAL_BIN`) — see [installation.md#durable-install](installation.md#durable-install). Schedule: pulse `7 7 * * *` (`sense && plan`, one chained invocation), reflex `*/10 * * * *` (`watch`), season `17 8 * * *` (`verdict`). A sleeping laptop misses ticks; catch-up runs overdue work on the next tick.

- **Exit codes**: 0, 1 (`E_CRONTAB`), 2 (`E_USAGE`, `E_EPHEMERAL_BIN`, `E_NEEDS_TTY`).
- **JSON data**: `print` → `{lines, bin, durable}`; `status` → `{installed, durable, bin}`; `install` → `{installed, lines}`; `uninstall` → `{removed}`.
- **Cost**: instant, 0 tokens, offline.

## ontology

Print the machine appendix — the Company Loop ontology as JSON (nouns, verbs, actors, clocks, invariants, the loop, and the bootstrap instruction). Offline agent bootstrap; the same payload with or without `--json`, un-enveloped, because this output is for machines.

- **Exit codes**: 0.
- **Cost**: instant, 0 tokens, offline; works outside a company directory.

---

<a id="configuration"></a>
## Configuration — `.cronfounder/config.json`

Human-owned. cronfounder never rewrites it; a model can never write it. Its presence is what marks a company directory.

```jsonc
{
  "v": 1,                        // config version (required, literal 1)
  "company": "my-co",            // display name
  "machine_id": "kaz-a1b2c3",    // stamped into every event; one active machine per company
  "currency": "usd",             // 3-letter; the single MRR currency
  "freshness_hours": 48,         // staleness window for baselines, verdicts, gap freshness
  "runtime": {
    "adapter": "claude",         // "claude" | "stub" | "none"
    "command": "claude",         // optional; binary override for the claude adapter
    "timeout_s": 600,            // hard timeout per runtime invocation
    "max_turns": 30
  },
  "drivers": { }                 // executable channel mappings — see below
}
```

Validation failures exit 2 with `E_CONFIG_INVALID` naming the exact field.

<a id="drivers"></a>
## Drivers

The executable mapping from a channel's three verbs to a concrete MCP server lives ONLY here, in the human-owned config. Channel `setup.md` files reference a driver by key (`driver_ref`) and are descriptive only — a model can draft `setup.md`; it cannot add an executable. The deterministic core is the MCP client; no model sits in the side-effect path.

Shape, with an X example (transport is `stdio`; pick your X MCP server and map its actual tool names):

```jsonc
{
  "drivers": {
    "x": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@your-choice/x-mcp-server"],
      "env_refs": ["X_MCP_CREDENTIAL"],        // env var NAMES passed through to the server — never values
      "tools": {
        "push": {
          "tool": "create_post",               // the server's tool name for posting
          "args_template": { "text": "{{text}}" },
          "extract": "content.0.text",         // dot-path into the tool result → external id
          "timeout_s": 60
        },
        "pull": {
          "tool": "list_replies",
          "args_template": { "since": "{{since}}" },
          "extract": "content.0.signals",      // dot-path → array of {id, signal, value, at}
          "timeout_s": 60
        }
      }
    }
  }
}
```

Contract details:

- **Template variables**: `push` renders `{{text}}`, `{{content}}`, `{{idempotency_key}}` into `args_template`; `pull` renders `{{since}}`. Values are strings; templates recurse through nested objects and arrays.
- **Extraction** is dot-path with numeric indexes only (e.g. `content.0.text`) — no expressions. `push` extraction should yield the platform's post id (falls back to the idempotency key); `pull` extraction must yield an array of signal objects `{id, signal, value, at}` (non-conforming entries are dropped; `id` is used for dedup).
- **Environment**: the driver subprocess gets a minimal passlist (PATH, HOME) plus exactly the vars named in `env_refs` and the channel's `credential_ref`. Nothing else leaks.
- **Probes**: readiness checks that every referenced env var resolves and that the server starts and answers `listTools` within 15 s.
- **Capabilities are honest**: a channel only gets the verbs its `capabilities` list declares; anything else is `E_UNSUPPORTED_CAPABILITY`. `subscribe` is implemented only by the mock driver today — declared in the ontology, deferred for real channels.
- Wiring a driver is exactly the kind of step a `setup_channel` card walks the human through; `cronfounder doctor` verifies the result.
