# Architecture

Three seams, one write path, and a crash-consistency story you can verify with `kill -9`.

```
files (canon: prose + human intent)      journal/events/*.jsonl (canon: facts)
        \                                       /
         `--- scan ---> company.db <--- replay `
                    (SQLite, derived projection — disposable)

runtime seam:  hats → staging dir → validate → import   (models propose; the core disposes)
driver seam:   core = MCP client → human-configured servers   (no model in the side-effect path)
```

## The storage seam

### Files are canon — for prose and human-owned fields

Every noun is a markdown file with YAML frontmatter. Human-owned fields (specs, claims, economics, doctrine, prose bodies) are authoritative in the files: the scanner imports them into the ledger on every mutating command, detects hand-edits via a hash over the human-owned fields, and journals each as a `human_edit` event. Files win.

Machine-owned mirror fields (`status`, `state`, `disposition`, `review_at`, `activated_at`, `baseline`, `verdict`, `readiness`, `track_record`) go the other way: the ledger wins, and `repairMirrors` rewrites drifted mirrors on every open — a hand-edited status is detectably overwritten without a sensor call. Edits are surgical, via the YAML Document API, so every human-owned byte (comments, ordering, formatting) survives. Writes are atomic (temp file + rename in the same directory). Aliases are budget-capped, custom tags rejected, dates are ISO strings, never YAML timestamps.

### The journal's machine layer — append-only facts

`journal/events/YYYY-MM-DD.jsonl`: append-only, sharded by day, in git. Events are the authoritative record for FACTS — transitions, measurements, publications, resolutions. Envelope on every event: `{id, v, at, machine, actor, type, ...payload}`; envelope fields always win over payload keys (a payload `id` can never clobber event identity — that would break dedup). `journal/YYYY-MM-DD.md` carries the human-readable narration alongside; corrections are new entries, never edits (invariant II).

**The event catalog** (`EVENT_VERSION = 1`) and what each type projects:

| event type | payload | projection |
|---|---|---|
| `company_initialized` | `{company}` | journal index only |
| `sensor_reading` | `{metric, value, measured_at, sensor}` | `metric_history` insert; `metrics.status_*` update; clears `sensor_failures` |
| `sensor_failure` | `{metric, sensor, error}` | `sensor_failures` upsert (consecutive counter) |
| `artifact_registered` | `{kind, subject, path}` | journal index only (document rows come from the file scan — never both) |
| `spec_set` | `{metric, target, deadline, set_by, baseline_value}` | `metrics` spec columns |
| `state_transition` | `{kind, subject, from, to, actor, reason?, snapshot?, activation fields...}` | `hypotheses.state` (+ activation/leverage/readiness columns), `contents.state` + a `content_transitions` row, or `projects.state` |
| `disposition_change` | `{kind, subject, disposition, reason}` | `hypotheses.disposition` |
| `compiled` | `{hypothesis, projects[], tasks[]}` | `projects` + `tasks` rows |
| `task_event` | `{task, project, from, to, claimed_by?}` | `tasks` state/claim columns |
| `inbox_created` | `{request, kind, payload, blocking_kind, blocking_id, urgent}` | `inbox` row |
| `inbox_resolved` | `{request, resolution, choice?, reason?}` | `inbox` → done, resolved_by = event actor |
| `push_intent` | `{intent, content, channel}` | `publications` row, state `intent` |
| `publication` | `{intent, content, channel, external_id}` | `publications` → `published` |
| `push_uncertain` | `{intent, content, channel, error}` | `publications` → `uncertain` |
| `push_resolved` | `{intent, outcome, external_id?}` | `publications` → `published`/`failed` |
| `watch_opened` | `{window, content, hypothesis, channel, opened_at, closes_at, tripwires}` | `watch_windows` row |
| `watch_closed` | `{window, outcome}` | `watch_windows` → `closed`/`tripped` |
| `tripwire_fired` | `{window, hypothesis, signal, observed, threshold}` | journal index only (the pause arrives as its own `state_transition`) |
| `verdict` | `{hypothesis, result, delta, baseline_reading, terminal_reading, algorithm_v}` | `hypotheses` verdict columns; playbook track-record counters |
| `human_edit` | `{path, fields}` | journal index only |
| `journal_note` | `{actor, action, refs, text}` | journal index only |

Every event additionally lands one row in `journal_index` (queryable memory) and its id in `applied_events` (the idempotence watermark). Unknown-but-not-newer event types are tolerated on read (forward-tolerant); newer-versioned events refuse (below).

### SQLite is a derived projection

`company.db` (node:sqlite, WAL mode, zero native deps) exists for queries, constraints, and speed. Every column's authority source is either a file field (imported at scan) or an event payload (projected at replay) — never both. One constraint carries an invariant: the partial unique index `wip_limit ON hypotheses(metric) WHERE state IN ('active','measuring','paused') AND disposition='open'` makes invariant VIII hold even against races; the violation is translated into the `E_WIP_LIMIT` gate refusal.

### rebuild — scan + replay, to a fixpoint

`cronfounder rebuild`: under the exclusive lock, delete all projection tables (and reset the relevant AUTOINCREMENT counters so replay reproduces identical row ids) → scan documents (files are canon) → replay every event shard in (day, position) order (facts are events) → repair machine-owned mirrors → checkpoint the WAL. Projection is idempotent (guarded by `applied_events`), so replaying twice equals replaying once — rebuild converges to a fixpoint. Equivalence is defined over a canonical dump (schema + ordered rows), never file bytes. If `company.db` vanishes, you lost convenience, never meaning.

## The runtime seam

### Typed adapters

`RuntimeAdapter` is an interface (`invoke(bundle, prompt, timeout)`), not a command string. Shipped adapters: `claude` (spawns the Claude Code CLI: argv arrays with `shell:false`, `-p`, `--output-format json`, `--allowedTools`, `--max-turns`, `--add-dir <staging>`; stdin closed so an unauthenticated CLI errors instead of hanging; hard timeout with process-tree kill), `stub` (deterministic, offline, writes schema-valid canned artifacts), and `none`. Selection precedence: `--runtime` flag > `CRONFOUNDER_RUNTIME` env > `runtime.adapter` in the human-owned config. Never model-writable.

### Hats — role, tools, and import table

The invoking command selects the hat; the runtime never chooses its own permissions:

| hat | tool allowlist | may import | max turns |
|---|---|---|---|
| planner | Read, Grep, Glob | narration | 10 |
| strategist | Read, Grep, Glob, WebSearch, WebFetch, Write | hypothesis | 40 |
| content_builder | Read, Grep, Glob, Write | content | 30 |
| channel_builder | Read, Grep, Glob, WebSearch, WebFetch, Write | channel_setup | 30 |
| onboarding | Read, Grep, Glob, WebSearch, WebFetch, Write | doctrine_draft (surfaced, never auto-canon) | 40 |
| narrator | Read | narration | 5 |

Enforcement is layered: allowlists constrain tools, but the real boundary is the import table + schema validation + mirror repair. The most intelligent actor (the strategist) has the richest read harness and zero side-effect reach — it can only propose files the core may refuse.

### The staging import boundary

Every run gets `.cronfounder/runs/<run-id>/` (prompt.md, run.json manifest) and a scratch `.cronfounder/staging/<run-id>/` — the only place a hat may write. `--dry-run` produces the same bundle without invoking anything; `run import` consumes it through the identical pipeline. Per-artifact validation at import: strict id regexes (filename must equal frontmatter id), no path characters or dotfiles in names, symlinks never imported, 256 KB size cap, schema parse, referential checks (metric/channel/provenance must exist — invariant VI), acceptance-matrix check at import (not at push), no overwriting existing ids. Valid artifacts import (event + canonical copy into the repo + rescan); invalid ones are rejected WITH REASONS and staging is preserved for inspection. Doctrine drafts are surfaced for a human diff, never auto-imported (web content is untrusted input).

### Environment passlists

The claude adapter passes through only `PATH, HOME, SHELL, TERM, USER, LANG, LC_ALL, ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN` — runtime auth only. Channel credentials are NEVER in a hat's environment. Driver subprocesses get PATH + HOME plus exactly the vars named in their `env_refs` and the channel's `credential_ref`. Prompts carry credential references (names), never values.

## The driver seam

Executable behavior — which binary to spawn, which MCP tool maps to which verb — lives ONLY in human-owned `.cronfounder/config.json` (`drivers.<ref>`). Channel `setup.md` files are descriptive; a model can draft one, it cannot add an executable. The deterministic core IS the MCP client (`@modelcontextprotocol/sdk`, stdio transport): no model sits in the side-effect path. The three verbs (`pull`, `push`, `subscribe`) sit behind one `Driver` interface with a `probe()` (credential resolution + server `listTools` within 15 s — readiness is computed, never declared). Response extraction is dot-path with numeric indexes only (`content.0.text`) — no expression language. Capability flags are honest per channel: the mock driver implements all three verbs (contract-tested; powers demo and e2e); real channels declare what they implement, and anything else returns the stable `E_UNSUPPORTED_CAPABILITY`. `subscribe` beyond mock is deferred, and documented as such.

## Crash consistency

### The write order

Every mutation goes through one API (`Store.commit`), in this order:

1. **append events** to `journal/events/<day>.jsonl` — the durable fact;
2. append prose narration to `journal/<day>.md` (append-only);
3. **apply file ops** — atomic temp-file + rename for writes, surgical frontmatter patches for mirrors;
4. **project events** into the ledger, transactionally, recording each id in `applied_events`.

A crash after (1) loses nothing: on the next open, reconcile replays all events not in `applied_events` (projection is idempotent) and mirror repair fixes drifted files from the ledger. A crash mid-append leaves a torn last line — it is quarantined (never thrown), reported by `doctor`, and journaled once; facts after a torn line are intact.

### Startup reconcile

Every command opens the store the same way. Mutating commands: acquire the lock → replay unapplied events → scan documents (import human edits) → repair machine-owned mirrors. Read-only commands reconcile projections in memory without the lock. `build` additionally resets any `claimed` tasks at start — since it holds the exclusive lock, any claim it sees is an orphan from a dead run (no lease math needed).

### Uncertain pushes

Push is intent → driver call → outcome, and the dangerous window is between the first two. If the driver call fails mid-flight, a `push_uncertain` event is recorded and an urgent decide card asks a human to verify on the platform — an uncertain delivery is NEVER auto-retried (double-posting in your principal's name is worse than a delay). If the process died before recording any outcome, `watch` finds the orphaned intent (older than a 5-minute in-flight grace) and files the same decide card. Re-running `push` while an intent is unresolved refuses with `E_PUSH_PENDING`, exit 3.

### The lock

One mutation at a time per company: `.cronfounder/lock`, created with `O_CREAT|O_EXCL`, holding a fingerprint `{pid, started, host, nonce, command}`. Stale detection: the owning pid is gone on this host → take over once and journal the takeover. A lock held by a *different host* is never auto-resolved — single-active-machine is the supported topology, and ambiguity refuses rather than guesses (`doctor` also flags multiple machine ids in the event history). Contention: interactive commands exit 4 (`E_BUSY`, retryable); `--cron` invocations exit 0 silently (`E_BUSY_NOOP`) so overlapping scheduled runs stay quiet. Release happens in a process exit handler, so even `process.exit` paths release.

## Versioning policy

Seeds now, tooling later:

- `schema_meta` holds `schema_version` (currently 1) and `min_reader_version`; every event carries `v` (currently 1); the config carries `v: 1`.
- **Forward refusal:** a cronfounder that finds a *newer* db schema or a *newer* event version refuses to mutate (`E_SCHEMA_NEWER`, `E_EVENT_NEWER`) — an old CLI under cron therefore fails safe instead of corrupting a newer company. Older/unknown-but-not-newer event types are tolerated on read.
- Historical events are never rewritten; upgrades will upcast at read/replay time.
- **Migration tooling (upgrade plan/apply, backup/restore, upcaster registry, template merges) is deferred until v0.2.0** — deliberately: v0.1.0 has zero installed base, and the unretrofittable part is the version markers, which are in. Documented as such; this is not a hidden gap.
