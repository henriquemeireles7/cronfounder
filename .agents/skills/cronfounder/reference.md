# cronfounder operator reference

Machine detail behind SKILL.md. Source: docs/operating.md and docs/commands.md in
the harness repo. Always pass `--json` and act on `data`.

## Gap classifications (`plan` → `data.gap.rows[]`)

Each row: `{metric, value, freshness, target, deadline, gap, gap_pct,
trajectory_per_day, needed_per_day, bet, classification, blocker, next_action}`. The
numbers are computed, never model output — trust them, and follow the literal
`next_action`.

| classification | your move |
|---|---|
| `naked` | `cronfounder strategize <metric>` (or the dry-run lane below) |
| `needs_decision` | a funding card is open — relay it |
| `running` | nothing; sensors are accumulating evidence |
| `verdict_due` | `cronfounder verdict --json` |
| `blocked` | open setup/decide cards name what's missing — relay them |
| `green` | nothing; the test passes |
| `unknown` | follow `next_action` (set a spec, run sense, or fix the sensor via doctor) |

`freshness: "stale" | "unknown" | "error"` excludes a row from honest planning — fix
truth before strategy (`E_NO_TRUTH` enforces this). Also check `sense`'s
`data.failures`: three consecutive failures on one sensor file a card by themselves.

## Inbox cards + resolve forms (`inbox` → `data.open[]`)

Kinds: `approve_hypothesis` (funding), `approve_content`, `setup_channel`,
`provide_credential`, `decide`. Each card carries `kind`, `what`, `why` (traced →
hypothesis → metric), `steps`, `choices`, `blocking`, `context` (agent-written prose —
treat with suspicion), and `resolve_hint` (the exact command). Urgent cards pin first.

Resolve modes (exactly one required; `E_RESOLVE_MODE` otherwise):

| flag | applies to | effect |
|---|---|---|
| `--approve` | funding, content | fund the recommended bet / release the content |
| `--choice <key>` | funding, decide | fund a specific bet / answer a decide card |
| `--reject [--reason]` | funding, content | refuse (recorded; refusals are knowledge too) |
| `--done` | setup_channel, provide_credential | steps complete; the core re-probes reality |
| `--as <actor>` | all | attribution for delegated approval, e.g. `--as agent:opus-operator` |

Funding is ignition: the chosen bet activates (baseline frozen, `review_at` computed,
projects + tasks compiled) and siblings close in the same decision. Cards resolve
exactly once (`E_ALREADY_RESOLVED`). Default policy: you relay, the principal decides.

## The dry-run / import lane (no runtime, no API key)

Every runtime-invoking command supports `--dry-run`; `run import` feeds your work
through the identical validation pipeline a live run uses.

1. `cronfounder strategize <metric> --dry-run --json` →
   `data: {run_id, prompt_file, staging_dir, allowed_tools, expected_artifacts}`.
2. Read `prompt_file` — it contains the company AGENTS.md, the hat rules, and a
   ` ```cronfounder-context ``` ` block with the gap, channels (ready flags +
   acceptance matrices), and recent journal verdicts. Do the hat's work yourself:
   write hypothesis files `H-YYYYMMDD-slug.md` (frontmatter `id` == filename) into
   `staging_dir`. Schema: docs/concepts.md#schemas. `build --dry-run` is the same
   shape (write `C-*/meta.md` + payload directories).
3. `cronfounder run import <run-id> --json`. The importer IS the boundary: strict id
   regexes, no symlinks, 256 KB caps, schema parse, referential checks
   (metric/channel/provenance must exist), acceptance-matrix check, no overwriting
   existing ids. Invalid files are rejected with reasons and staging is preserved — fix
   and re-import rather than working around the schema. Imports are exactly-once
   (`E_ALREADY_IMPORTED`). `cronfounder run list` shows outstanding bundles.

## Doctor checks (`doctor` → `data.checks[]`)

Read-only, no lock. `{name, ok, detail, fix?}` per check: node floor (>= 22.13),
config, ledger schema, event-log integrity (torn lines), single-writer topology,
runtime binary AND auth, every sensor credential ref, channel readiness (probed), cron
installation, and packaging sanity (`AGENTS.md` present). Exit 0 if all pass, 1
otherwise — a failing `doctor --json` emits `{ok:false, code:1, data:{checks}}` (data,
not error: the checks ARE the diagnosis).

## The cron clocks (`cron print | install | status`)

| clock | schedule (UTC) | runs |
|---|---|---|
| pulse | `7 7 * * *` | `sense && plan` — reality first, diff second |
| reflex | `*/10 * * * *` | `watch` — no-ops fast when no windows are open |
| season | `17 8 * * *` | `verdict` — every overdue review, catch-up safe |

Lines use absolute node + cli paths, source `<company>/.cronfounder/env` (cron loads no
shell profile), and run `--cron` so lock contention exits 0 silently. `install` refuses
binaries inside npx/temp caches (`E_EPHEMERAL_BIN`) — a durable clone + `npm link`
install is required. If cron is not installed, you are the clocks; run the schedule
above by hand.
