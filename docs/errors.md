# Error registry

Every failure carries a stable machine-matchable code, an exit code, and a problem/cause/fix triple. Under `--json` the error object also carries `invariant` (for gate refusals), `retryable`, and a `docs` pointer that resolves to an anchor on this page (`E_FOO_BAR` → `#e-foo-bar`).

Exit code legend: **1** error · **2** validation/usage · **3** gate-refused (an invariant said no — relay it, never work around it) · **4** busy/locked (retryable). One special case exits **0** and is documented below.

---

## Environment and setup

<a id="e-node-version"></a>
### E_NODE_VERSION — exit 1
- **Problem:** cronfounder needs Node >= 22.13 (you have an older version).
- **Cause:** the embedded ledger uses `node:sqlite`, flag-free since 22.13.
- **Fix:** install a current Node LTS — https://nodejs.org

<a id="e-no-company"></a>
### E_NO_COMPANY — exit 2
- **Problem:** not inside a cronfounder company (the directory looked at has no `.cronfounder/config.json`).
- **Cause:** wrong cwd, or `--company`/`CRONFOUNDER_DIR` points at a non-company directory.
- **Fix:** cd into your company directory, pass `--company <dir>`, or create one: `cronfounder init <dir>`.

<a id="e-config-invalid"></a>
### E_CONFIG_INVALID — exit 2
- **Problem:** `.cronfounder/config.json` is not valid JSON, or failed validation at a named field.
- **Cause:** the file was hand-edited into an invalid state or truncated by a crash; a field is missing or has the wrong type.
- **Fix:** fix the file by hand (it is human-owned; cronfounder never rewrites it); compare against the reference in [commands.md#configuration](commands.md#configuration).

<a id="e-dir-not-empty"></a>
### E_DIR_NOT_EMPTY — exit 2
- **Problem:** the target directory is not empty and is not a cronfounder company.
- **Cause:** `init` refuses to scaffold over unknown files.
- **Fix:** point init at a new directory, or pass `--force` to scaffold anyway.

## Usage

<a id="e-needs-tty"></a>
### E_NEEDS_TTY — exit 2
- **Problem:** this step needs an answer and stdin is not a terminal.
- **Cause:** cronfounder never blocks waiting for input a scheduler or agent can't give — a hidden prompt is a hung session.
- **Fix:** pass the flag named in the error (e.g. `--yes`) to answer non-interactively.

<a id="e-missing-arg"></a>
### E_MISSING_ARG — exit 2
- **Problem:** a required argument is missing.
- **Cause:** the command cannot infer the value.
- **Fix:** the error shows an exact example invocation.

<a id="e-usage"></a>
### E_USAGE — exit 2
- **Problem:** unknown subcommand (e.g. `cron` takes only `print | install | status`).
- **Cause:** typo or wrong verb.
- **Fix:** the error names the valid subcommands.

<a id="e-bad-id"></a>
### E_BAD_ID — exit 2
- **Problem:** the argument is not a request id.
- **Cause:** request ids look like `R-12`.
- **Fix:** list open requests: `cronfounder inbox`.

<a id="e-wrong-id-kind"></a>
### E_WRONG_ID_KIND — exit 2
- **Problem:** you passed a hypothesis id (`H-…`) or content id (`C-…`) where a request id (`R-…`) belongs.
- **Cause:** bets are funded through their funding card and content through its approve_content card, so every approval is auditable.
- **Fix:** find the card: `cronfounder inbox`, then `cronfounder resolve R-<n> --choice <H-id>` (for bets) or `--approve` (for content).

<a id="e-not-found"></a>
### E_NOT_FOUND — exit 2 (exit 1 when the ledger references something deleted by hand)
- **Problem:** the named metric / hypothesis / request / content / task / run / channel does not exist.
- **Cause:** wrong id, a stale ledger, or a hand-deleted directory.
- **Fix:** list what exists (`cronfounder board --json`, `cronfounder inbox`, `cronfounder run list`); repair a stale ledger with `cronfounder rebuild`.

<a id="e-validation"></a>
### E_VALIDATION — exit 2
- **Problem:** generic validation failure (the default code for one-off validation errors).
- **Cause:** named in the specific message.
- **Fix:** named in the specific message.

## Locking and concurrency

<a id="e-busy"></a>
### E_BUSY — exit 4, retryable
- **Problem:** another cronfounder command is running (the error names its command, pid, host, and start time).
- **Cause:** mutating commands take a per-company lock so state changes stay serial.
- **Fix:** retry when it finishes. If the owning process on another machine is truly gone, remove `.cronfounder/lock` by hand — single-active-machine is the supported topology.

<a id="e-busy-noop"></a>
### E_BUSY_NOOP — exit 0
- **Problem:** another run holds the company lock; a `--cron` invocation exits quietly instead.
- **Cause:** overlapping scheduled runs are expected; the lock keeps mutations serial.
- **Fix:** none needed. (This is the one "error" that is a clean no-op by design.)

<a id="e-readonly"></a>
### E_READONLY — exit 1
- **Problem:** a mutation was attempted from a read-only command.
- **Cause:** internal misuse of the core API — a cronfounder bug, not your company state.
- **Fix:** report at https://github.com/henriquemeireles7/cronfounder/issues

## Documents and YAML

<a id="e-frontmatter-missing"></a>
### E_FRONTMATTER_MISSING — exit 2
- **Problem:** the file has no frontmatter block.
- **Cause:** every document must start with `---` followed by YAML frontmatter.
- **Fix:** add one; the `templates/` directory shows the expected shape per file type.

<a id="e-frontmatter-unterminated"></a>
### E_FRONTMATTER_UNTERMINATED — exit 2
- **Problem:** the frontmatter never closes.
- **Cause:** missing the closing `---` line.
- **Fix:** close the block with a line containing only `---`.

<a id="e-yaml-invalid"></a>
### E_YAML_INVALID — exit 2
- **Problem:** frontmatter is invalid YAML (the error names file and line), or is not a mapping.
- **Cause:** often an unquoted colon or bad indentation.
- **Fix:** quote string values containing `:`; dates must be quoted ISO strings; frontmatter must be `key: value` pairs.

<a id="e-file-missing"></a>
### E_FILE_MISSING — exit 1
- **Problem:** a referenced file cannot be read.
- **Cause:** the path does not exist (often deleted by hand while the ledger still references it).
- **Fix:** check the path; if the ledger references a deleted file, run `cronfounder rebuild`.

<a id="e-path-escape"></a>
### E_PATH_ESCAPE — exit 2
- **Problem:** a content `payload_file` resolves outside its content directory.
- **Cause:** `payload_file` is model-authored and must be a bare filename; a path separator, `..`, or an absolute path would read or write outside the sandbox. The staging import and every read site refuse it.
- **Fix:** set `payload_file` in the content's `meta.md` to a plain filename (e.g. `payload.txt`), then re-run.

## Gate refusals (exit 3 — the product working)

<a id="e-wip-limit"></a>
### E_WIP_LIMIT — exit 3, invariant VIII
- **Problem:** the metric already has an active bet (named in the error).
- **Cause:** one active hypothesis per metric — attribution before ambition. Enforced at constraint level; races lose politely.
- **Fix:** wait for the holder's verdict (`cronfounder board`), or bet on a different metric.

<a id="e-illegal-transition"></a>
### E_ILLEGAL_TRANSITION — exit 3
- **Problem:** the requested state change is not in the transition table (e.g. draft → published).
- **Cause:** state machines are enforced by the core; the error lists the legal moves from the current state.
- **Fix:** perform the legal move — usually via the owning command.

<a id="e-wrong-actor"></a>
### E_WRONG_ACTOR — exit 3
- **Problem:** the transition is legal but not for this actor (e.g. only a human crosses `pending_approval → approved`).
- **Cause:** the actor column of the transition table.
- **Fix:** the human resolves it: `cronfounder resolve <R-id> --approve` (or the owning command performs it).

<a id="e-gate-unapproved"></a>
### E_GATE_UNAPPROVED — exit 3, invariant III
- **Problem:** the content is not `approved` (it is pending_approval, draft, or already published).
- **Cause:** nothing side-effectful skips the gate.
- **Fix:** release it first via its approve_content card: `cronfounder inbox`.

<a id="e-push-pending"></a>
### E_PUSH_PENDING — exit 3, invariant III
- **Problem:** the content has an unresolved push intent (it may already be on the platform).
- **Cause:** re-pushing could double-post; uncertain deliveries are never auto-retried.
- **Fix:** verify on the platform, then resolve the decide card: `cronfounder resolve R-<n> --choice published|failed` (or run `cronfounder watch` to reconcile orphaned intents into a card).

<a id="e-not-ready"></a>
### E_NOT_READY — exit 3, invariant IV
- **Problem:** the hypothesis is not ready (missing credentials or driver mappings, listed in the error).
- **Cause:** missing infrastructure is visible, queued work — not silent death.
- **Fix:** resolve its setup_channel / provide_credential cards first: `cronfounder inbox`.

<a id="e-risk-gate"></a>
### E_RISK_GATE — exit 3, invariant X
- **Problem:** the hypothesis is irreversible and can never enter the green lane.
- **Cause:** risk gates cannot be bought.
- **Fix:** a human must fund it: `cronfounder resolve <R-id> --approve`.

<a id="e-no-baseline"></a>
### E_NO_BASELINE — exit 3, invariant IX
- **Problem:** the metric has no sensor history — a verdict would have no starting point.
- **Cause:** sense has never successfully measured this metric.
- **Fix:** run `cronfounder sense`, then retry the approval.

<a id="e-baseline-stale"></a>
### E_BASELINE_STALE — exit 3, invariant IX, retryable
- **Problem:** the latest baseline reading is older than the freshness window (default 48 h).
- **Cause:** activating on a stale baseline would poison the verdict.
- **Fix:** run `cronfounder sense`, then retry the approval.

<a id="e-metric-busy"></a>
### E_METRIC_BUSY — exit 3, invariant VIII
- **Problem:** the metric has a live bet — no new bets while one is measuring.
- **Cause:** one active hypothesis per metric: attribution before ambition.
- **Fix:** wait for the verdict (the error names when it is due), or strategize a different metric.

## Resolving cards

<a id="e-already-resolved"></a>
### E_ALREADY_RESOLVED — exit 2
- **Problem:** the request was already resolved (the error says how and when).
- **Cause:** cards resolve exactly once — the journal remembers.
- **Fix:** nothing to do; see `cronfounder inbox`.

<a id="e-resolve-mode"></a>
### E_RESOLVE_MODE — exit 2
- **Problem:** resolve needs exactly one of `--approve`, `--reject`, `--done`, `--choice <key>` — or the flag you used does not apply to this card kind.
- **Cause:** the resolution must be unambiguous; it becomes a permanent journal fact.
- **Fix:** the error shows the valid invocations for this card's kind.

<a id="e-bad-choice"></a>
### E_BAD_CHOICE — exit 2
- **Problem:** the value passed to `--choice` is not one of the card's choices.
- **Cause:** the error lists the valid keys.
- **Fix:** pick one of them.

<a id="e-unknown-kind"></a>
### E_UNKNOWN_KIND — exit 1
- **Problem:** the request has a card kind this cronfounder does not know.
- **Cause:** a newer cronfounder may have filed it.
- **Fix:** upgrade cronfounder.

<a id="e-still-not-ready"></a>
### E_STILL_NOT_READY — exit 2, retryable
- **Problem:** you resolved a setup card with `--done` but the channel is still not ready (missing items listed).
- **Cause:** the core re-probes after `--done`; declaring readiness doesn't create it.
- **Fix:** finish the remaining steps, verify with `cronfounder doctor`, then retry.

<a id="e-disposed"></a>
### E_DISPOSED — exit 2
- **Problem:** the hypothesis is `rejected` or `closed_inconclusive`.
- **Cause:** disposed bets cannot be activated.
- **Fix:** pick an open bet from `cronfounder board`.

## Strategize preconditions

<a id="e-bets-pending"></a>
### E_BETS_PENDING — exit 2
- **Problem:** the metric already has an unresolved bet set awaiting a funding decision.
- **Cause:** strategize is idempotent per gap — regenerating bets would duplicate spend without new information.
- **Fix:** decide first: `cronfounder inbox` (approve, choose, or reject the open set).

<a id="e-no-gap"></a>
### E_NO_GAP — exit 2
- **Problem:** the metric is at or above target — there is no gap to close.
- **Cause:** strategize exists to close failing tests, and this one passes.
- **Fix:** raise the spec in the metric file if ambition grew, or strategize a red metric.

<a id="e-no-truth"></a>
### E_NO_TRUTH — exit 2
- **Problem:** the metric has no spec or no fresh reading — a plan computed on fiction is fiction.
- **Cause:** no spec, never sensed, or the sensor is failing.
- **Fix:** the error names the exact next action (edit the spec, run `cronfounder sense`, or `cronfounder doctor`).

## Runtime

<a id="e-runtime-unknown"></a>
### E_RUNTIME_UNKNOWN — exit 2
- **Problem:** unknown runtime adapter name.
- **Cause:** `runtime.adapter` must be one of `claude`, `stub`, `none`.
- **Fix:** edit `.cronfounder/config.json` or pass `--runtime claude|stub`.

<a id="e-runtime-none"></a>
### E_RUNTIME_NONE — exit 1
- **Problem:** the command needs a runtime to think, and none is configured.
- **Cause:** `runtime.adapter` is `"none"`.
- **Fix:** three ways forward: install Claude Code and set the adapter to `"claude"`; run with `--dry-run` and do the thinking yourself, then `cronfounder run import <run-id>`; or try the harness keyless first: `cronfounder init demo-co --demo`.

<a id="e-runtime-not-found"></a>
### E_RUNTIME_NOT_FOUND — exit 1
- **Problem:** the runtime binary cannot be spawned.
- **Cause:** `claude` is not on PATH (or `runtime.command` is wrong).
- **Fix:** install Claude Code (https://claude.com/claude-code), set `runtime.command`, or use `--dry-run`.

<a id="e-runtime-failed"></a>
### E_RUNTIME_FAILED — exit 1, retryable
- **Problem:** the runtime exited non-zero for the hat.
- **Cause:** the tail of its output is included; "no output" is most often an unauthenticated CLI (it cannot prompt for login here — stdin is closed by design).
- **Fix:** verify auth with `cronfounder doctor`, or wear the hat yourself via `--dry-run` + `cronfounder run import <run-id>`.

<a id="e-runtime-timeout"></a>
### E_RUNTIME_TIMEOUT — exit 1, retryable
- **Problem:** the runtime exceeded `runtime.timeout_s` and its process tree was killed.
- **Cause:** the run hung, or the task is larger than the timeout allows.
- **Fix:** raise `runtime.timeout_s` in `.cronfounder/config.json`, or use `--dry-run` + `run import` to do the step yourself.

## Dry-run and import

<a id="e-already-imported"></a>
### E_ALREADY_IMPORTED — exit 2
- **Problem:** the run has no staging dir — it was already imported (staging is cleaned on success).
- **Cause:** imports are exactly-once.
- **Fix:** start a fresh `--dry-run` if you need another pass.

<a id="e-no-metric"></a>
### E_NO_METRIC — exit 2
- **Problem:** cannot infer which metric a strategist run targets.
- **Cause:** no valid `H-*.md` in staging names a metric.
- **Fix:** write at least one schema-valid hypothesis file into the staging dir first.

## Sensors and credentials

<a id="e-sensor-unknown"></a>
### E_SENSOR_UNKNOWN — exit 2
- **Problem:** the metric declares an unknown sensor type.
- **Cause:** `sensor.type` must be one of `github_stars`, `stripe_mrr`, `x_post_metrics`, `mock`.
- **Fix:** edit the metric file.

<a id="e-sensor-config"></a>
### E_SENSOR_CONFIG — exit 2 (github/X: bad fields) or 1 (mock: missing state file)
- **Problem:** the sensor's configuration is unusable (github_stars needs `repo: "owner/name"`; x_post_metrics needs a published content id and supported field; mock needs its state file).
- **Cause:** missing/malformed field, or the mock channel was never seeded.
- **Fix:** set `sensor.repo`; for X set `sensor.content`, `sensor.field`, and `credential_ref: X_BEARER_TOKEN`; or seed the mock: `echo '{"value": 10}' > .cronfounder/mock/mock.json` (`init --demo` does this for you).

<a id="e-sensor-network"></a>
### E_SENSOR_NETWORK — exit 1, retryable
- **Problem:** network failure reaching the sensor's API.
- **Cause:** connectivity.
- **Fix:** retry. Sense isolates failures per sensor, so other metrics still updated.

<a id="e-sensor-rate-limit"></a>
### E_SENSOR_RATE_LIMIT — exit 1, retryable
- **Problem:** the sensor provider refused the read for rate, permission, or spending limits (HTTP 403/429).
- **Cause:** GitHub unauthenticated limits, or X read permissions/rate/spending limits.
- **Fix:** for GitHub, export `GITHUB_TOKEN`; for X, check app read permission, credits, and the spending cap.

<a id="e-sensor-not-found"></a>
### E_SENSOR_NOT_FOUND — exit 1
- **Problem:** the GitHub repo, X post, or published external id was not found.
- **Cause:** renamed/deleted/unavailable resource, wrong config, or X content that has not published successfully.
- **Fix:** update `sensor.repo`; for X, publish the configured `sensor.content` and verify the post still exists.

<a id="e-sensor-http"></a>
### E_SENSOR_HTTP — exit 1, retryable
- **Problem:** the sensor's API returned an unexpected HTTP status.
- **Cause:** the response body's first 200 chars are included.
- **Fix:** retry; if persistent, check the provider's status page.

<a id="e-sensor-shape"></a>
### E_SENSOR_SHAPE — exit 1
- **Problem:** the response (or mock state file) did not have the expected shape.
- **Cause:** unexpected API shape, or a hand-edited state file.
- **Fix:** for mock, set a numeric value: `{"value": 42}`; for APIs, report the issue.

<a id="e-credential-ref-missing"></a>
### E_CREDENTIAL_REF_MISSING — exit 2
- **Problem:** the sensor requires a `credential_ref` (the NAME of an environment variable) and has none.
- **Cause:** secrets are never stored in files (invariant IV).
- **Fix:** add `sensor.credential_ref` (e.g. `"STRIPE_API_KEY"`) to the metric file, then export that variable.

<a id="e-credential-unresolved"></a>
### E_CREDENTIAL_UNRESOLVED — exit 1
- **Problem:** the referenced env var is not set in this environment.
- **Cause:** commonly cron — it does not load your shell profile.
- **Fix:** `export <VAR>=...` interactively, or add it to `.cronfounder/env` (which the cron lines source); verify with `cronfounder doctor`.

<a id="e-credential-rejected"></a>
### E_CREDENTIAL_REJECTED — exit 1
- **Problem:** the provider rejected the credential (e.g. Stripe API key or X bearer token, HTTP 401).
- **Cause:** invalid, revoked, or under-scoped key.
- **Fix:** replace the referenced env var with a valid, correctly scoped provider credential; Stripe MRR needs Subscriptions: Read, and X metrics need an app-only bearer token.

## Channels and drivers

<a id="e-driver-unconfigured"></a>
### E_DRIVER_UNCONFIGURED — exit 2
- **Problem:** the channel has no `driver_ref`, or references a driver missing from `.cronfounder/config.json`.
- **Cause:** executable driver mappings live only in the human-owned config — a `setup.md` reference alone spawns nothing.
- **Fix:** add `driver_ref` to the channel's setup.md AND the matching `drivers.<ref>` entry in the config ([commands.md#drivers](commands.md#drivers)).

<a id="e-driver-verb-unmapped"></a>
### E_DRIVER_VERB_UNMAPPED — exit 2
- **Problem:** the driver maps no MCP tool to the verb being called (push/pull).
- **Cause:** `drivers.<ref>.tools.<verb>` is missing.
- **Fix:** add the tool mapping to `.cronfounder/config.json`.

<a id="e-driver-tool-error"></a>
### E_DRIVER_TOOL_ERROR — exit 1
- **Problem:** the MCP tool ran and reported an error.
- **Cause:** the tool's error text is included.
- **Fix:** check the driver server's credentials and the `args_template` in the config. This is a definitive failed push, not an uncertain delivery; X duplicate-content errors require changing the post text.

<a id="e-push-uncertain"></a>
### E_PUSH_UNCERTAIN — exit 1
- **Problem:** a push failed mid-call — the request may or may not have reached the platform.
- **Cause:** the MCP call errored or timed out after the request may have been received.
- **Fix:** cronfounder recorded the uncertainty and filed a decide card — verify on the platform, then resolve the card. Do NOT re-run push blindly.

<a id="e-unsupported-capability"></a>
### E_UNSUPPORTED_CAPABILITY — exit 2
- **Problem:** the channel does not implement this verb (e.g. `subscribe` on a real channel).
- **Cause:** conformance per channel is documented, not assumed; the mock channel implements all three verbs.
- **Fix:** check `capabilities` in the channel's setup.md.

## Cron

<a id="e-ephemeral-bin"></a>
### E_EPHEMERAL_BIN — exit 2
- **Problem:** refusing to install cron lines that point into an npx/temp cache.
- **Cause:** npx caches get pruned — the clocks would die silently weeks from now.
- **Fix:** install durably first ([installation.md#durable-install](installation.md#durable-install)), then re-run `cron install`.

<a id="e-crontab"></a>
### E_CRONTAB — exit 1
- **Problem:** `crontab` refused the new lines.
- **Cause:** the crontab stderr is included.
- **Fix:** install by hand: `cronfounder cron print`, then `crontab -e`.

## Versioning

<a id="e-schema-newer"></a>
### E_SCHEMA_NEWER — exit 1
- **Problem:** `company.db` was written by a newer cronfounder than this one.
- **Cause:** another machine or an upgraded cron install wrote the ledger.
- **Fix:** upgrade this installation. Read-only commands (board, inbox) may still work.

<a id="e-event-newer"></a>
### E_EVENT_NEWER — exit 1
- **Problem:** an event in the journal has a version newer than this cronfounder understands.
- **Cause:** a newer cronfounder appended events to this company.
- **Fix:** upgrade before mutating; historical events are never rewritten.

## Catch-all

<a id="e-unexpected"></a>
### E_UNEXPECTED — exit 1
- **Problem:** an unexpected internal error.
- **Cause:** a cronfounder bug, not your company state.
- **Fix:** re-run with `--json` for machine detail; report at https://github.com/henriquemeireles7/cronfounder/issues
