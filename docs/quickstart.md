# Quickstart

Two first-class tracks. Track A needs zero credentials and finishes a full loop — through a verdict — in a few minutes. Track B is your real company.

Cost honesty up front: `sense`, `board`, `inbox`, `resolve`, `push`, `watch`, `rebuild`, and the verdict computation are model-free. Only `strategize` and `build` invoke the runtime (minutes + tokens); `plan` adds one optional page of narration if a runtime exists; the demo's stub runtime costs nothing.

---

## Track A — the keyless demo (stub runtime + mock channel)

Everything here is offline and deterministic. The mock channel is a JSON file; the stub runtime writes canned but schema-valid artifacts. The gaps, gates, leverage math, WIP limits, and verdicts are the real machinery.

### 1. Init (~30–60 s, 0 tokens)

```sh
cronfounder init demo-co --demo && cd demo-co
```

Expect checkpoint lines on stderr (`scaffold`, `doctrine`, `metric`, `sense`, `plan`, `strategize`), then the magic moment on stdout:

```
The loop just closed for the first time. One decision is waiting:

INBOX  generated 2026-07-14T09:00:00Z

R-1 · approve_hypothesis 2026-07-14T09:00:00Z
  what:     fund ONE bet to close the demo_signups gap (88 signups short)
  why:      demo_signups is a failing test; these are the strategist's priced, falsifiable options ...
  choices:
    H-20260714-founder-story-thread — [recommended] Post a 5-part founder story on mock; ...
    H-20260714-comparison-page — Ship one honest comparison page ...
    H-20260714-reply-guy-sprint — Answer 20 in-ICP questions ...
  blocking: all work on demo_signups until a bet is funded (approval is ignition)
  → cronfounder resolve R-1 --approve | --choice <H-id> | --reject
```

What just happened: a `demo_signups` metric was created (spec: 12 → 100 in 30 days, mock sensor), `sense` read reality (12), `plan` classified the gap as naked (gap 88), and the strategist proposed three bets, leverage-ranked. Each choice shows Δ claimed, cost in tokens + human-minutes, risk, confidence with source, and leverage.

### 2. Inspect (instant, 0 tokens)

```sh
cronfounder inbox          # the card again, any time
cronfounder board          # 4 sections: needs funding / running / blocked / verdicts
cronfounder plan --json    # the gap model as JSON (data.gap.rows[0].classification == "needs_decision")
```

The same views exist as files: `inbox/R-1.md` and static HTML at `.cronfounder/site/inbox.html` and `board.html`.

### 3. Fund a bet (instant, 0 tokens)

```sh
cronfounder resolve R-1 --approve
```

```
funded H-20260714-founder-story-thread — approval is ignition:
  1 project(s), 1 task(s) compiled
  verdict due 2026-07-28T09:01:00Z (sensors decide, not the believers)

next: cronfounder build   (drafts will arrive as approve_content cards, ~minutes with a runtime)
```

Approval is ignition: the bet went `prioritized → active`, its baseline reading (12) was frozen for the verdict, `review_at` was computed (+14 days), siblings were closed in the same decision (`disposition: rejected` — attribution before ambition), and the experiment compiled into projects and tasks. Try `cronfounder resolve R-1 --approve` again: `E_ALREADY_RESOLVED`, exit 2. Cards resolve exactly once.

### 4. Build (seconds with the stub; 0 tokens)

```sh
cronfounder build
```

```
drafted: C-20260714-post-a-5-part-founder-st-1, ... (5 drafts)
5 approval card(s) filed — release drafts: cronfounder inbox
```

The funded bet's project asked for 5 posts, so the builder staged 5 content directories; the core validated each (schema, provenance chain to task → project → hypothesis → metric, channel acceptance) and moved them `draft → pending_approval`. Nothing side-effectful skips the gate.

### 5. Release and push (instant, 0 tokens)

```sh
cronfounder inbox                   # R-2..R-6, one approve_content card per draft
cronfounder resolve R-2 --approve   # release one
cronfounder push                    # publishes everything approved
```

```
C-20260714-post-a-5-part-founder-st-1 → mock: published (I-...)
```

Push wrote a `push_intent` event, called the mock driver (which appended the post to `.cronfounder/mock/mock.json`), recorded the publication, and opened a 60-minute watch window. `cronfounder watch` now evaluates that window (it no-ops fast when nothing is open — cron-safe).

Try pushing an unreleased draft: `cronfounder push C-20260714-...-2` → `E_GATE_UNAPPROVED`, exit 3, naming invariant III. That refusal is the product working.

### 6. Time-travel to the verdict (instant, 0 tokens)

The verdict is due at `review_at`, 14 days out. `CRONFOUNDER_NOW` (an ISO timestamp) freezes the clock, so you can simulate the season. First, simulate the world responding — edit the mock state the sensor reads:

```sh
node -e 'const fs=require("fs"),f=".cronfounder/mock/mock.json";const s=JSON.parse(fs.readFileSync(f,"utf8"));s.value=45;fs.writeFileSync(f,JSON.stringify(s,null,2))'
```

Then sense at `review_at` (a verdict needs a reading at or before `review_at`, within the 48h freshness window) and run the verdict just after:

```sh
REVIEW_AT=$(cronfounder board --json | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.running[0].review_at')
CRONFOUNDER_NOW=$REVIEW_AT cronfounder sense
CRONFOUNDER_NOW=$REVIEW_AT cronfounder watch      # optional: closes the watch window clean
CRONFOUNDER_NOW=$(node -pe 'new Date(new Date(process.argv[1]).getTime()+3600e3).toISOString()' "$REVIEW_AT") cronfounder verdict
```

```
H-20260714-founder-story-thread: VALIDATED (Δ +33)
```

Delta = terminal reading (45) − baseline frozen at activation (12) = +33, ≥ the kill threshold the bet declared. The verdict came from sensor history alone (invariant IX). Because a runtime (the stub) is configured and the metric is still red and naked, verdict immediately re-strategized it — check `cronfounder inbox`: a fresh funding card is waiting. The loop closed, learned, and continued.

### 7. Prove invariant V (optional, instant)

```sh
rm company.db && cronfounder rebuild
```

```
rebuilt: N documents scanned, M events replayed, 0 mirror(s) repaired
the ledger is derived; meaning lives in your files and journal.
```

The SQLite ledger is a projection. Files + `journal/events/*.jsonl` are the truth.

**Track A total: ~5 minutes, 0 tokens, 0 credentials, 0 network.**

---

## Track B — a real company

Prerequisites: durable install ([installation.md](installation.md#durable-install)), Claude Code installed and authenticated (`cronfounder doctor` verifies both), a website and/or GitHub repo to ground doctrine in.

### 1. Init with your artifacts (2–10 min; one onboarding run + one strategist run of tokens)

```sh
cronfounder init my-co --url https://your-site.com --repo you/your-repo
cd my-co
```

Interactively, onboarding reads your artifacts, drafts `doctrine/identity.md`, and shows you the diff to confirm — the draft is never canon until you approve it (web content is untrusted input). With `--yes` (agent mode) the draft lands at `doctrine/identity.draft.md` plus a review card instead. `--repo` also creates a `github_stars` metric (default spec: 500 stars in 90 days — edit to your real ambition; the default is a starting point, not a strategy).

init then runs the first loop itself: sense → plan → strategize on the first naked gap → your first funding card. If any bet targets a channel that is not set up yet, it registers as `blocked` and a `setup_channel` card is queued instead — missing infrastructure is visible, queued work, not silent death.

<a id="first-metric"></a>
### 2. Or add a metric by hand (2 min, 0 tokens)

```sh
cp metrics/EXAMPLE-github_stars.md.txt metrics/github_stars.md
$EDITOR metrics/github_stars.md    # set sensor.repo, spec.target, spec.deadline
cronfounder sense
```

`sense` hits the public GitHub API — no credential needed; `export GITHUB_TOKEN=...` raises the rate limit from 60 to 5000 requests/hour. For MRR, add a metric with `sensor.type: stripe_mrr` and `sensor.credential_ref: STRIPE_API_KEY` (a restricted key with Subscriptions: Read). The MRR formula contract is in [concepts.md](concepts.md#mrr).

### 3. Read the diff (seconds; narration optional)

```sh
cronfounder plan
```

The gap report is computed deterministically — classification, direction-adjusted gap, trajectory, needed-per-day, freshness, and a next action per metric. If a runtime is configured, the planner adds one page of narration (~1 min, small token cost); pass `--runtime none` to skip it.

### 4. Strategize (5–15 min; ≈ one long research session of tokens)

```sh
cronfounder strategize github_stars
```

The strategist reads your doctrine, journal verdicts, and channel matrix, researches, and registers 3–7 bets. Schema-invalid bets are rejected with reasons (invariant VII has no exceptions: `kill_criteria.min_delta` of 0 does not parse). One funding card is filed per gap; strategize is idempotent — re-running while the card is open refuses with `E_BETS_PENDING`.

Prefer to do the thinking yourself (or in your own agent session)? `cronfounder strategize github_stars --dry-run` writes the exact prompt and staging dir; then `cronfounder run import <run-id>`. Zero tokens billed to cronfounder; you were the runtime.

### 5. Fund, build, release, push (build ≈ one drafting session of tokens per project)

```sh
cronfounder inbox
cronfounder resolve R-1 --approve        # or --choice H-... , or --reject --reason "..."
cronfounder build                        # minutes + tokens; drafts stop at the gate
cronfounder inbox
cronfounder resolve R-2 --approve
cronfounder push
```

Pushing to a real channel (e.g. X) requires the human-owned driver mapping in `.cronfounder/config.json` and the channel credential — see [commands.md#drivers](commands.md#drivers). Until a channel is ready, bets that need it queue setup cards, and `cronfounder doctor` shows exactly what is missing. The mock channel is always available for rehearsal.

### 6. Install the clocks (instant)

```sh
cronfounder cron install
```

```
clocks installed. The company now runs while you sleep:
  pulse 07:07 UTC · reflex every 10 min · season 08:17 UTC
```

Pulse runs `sense && plan`, reflex runs `watch` (no-ops instantly when no windows are open), season runs `verdict` (processes every overdue review — catch-up safe). Sensor credentials for cron go in `.cronfounder/env` (cron loads no shell profile). Caveat, honestly: a sleeping laptop misses ticks; overdue work runs on the next tick. A tiny server is the honest home for a company.

### 7. Verify everything

```sh
cronfounder doctor
```

Checks node floor, config, ledger, event-log integrity, runtime binary AND auth, every credential ref, channel readiness, and whether the clocks are installed. Exit 0 means the loop can close.

### Honest costs per step (Track B)

| step | wall time | tokens |
|---|---|---|
| init with `--url`/`--repo` | 2–10 min | one onboarding run + one strategist run |
| sense / board / inbox / resolve / rebuild | seconds | 0 |
| plan | seconds | 0 (+ ~1 page of narration if a runtime is configured) |
| strategize | 5–15 min | ≈ one long research session |
| build | minutes per project | ≈ one drafting session per project |
| push / watch | seconds | 0 |
| verdict | seconds | 0 (may trigger a strategist run afterward on red, naked metrics when a runtime is configured) |
| doctor | seconds | one 1-turn test invocation (runtime auth probe) |
