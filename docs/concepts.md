# Concepts — the Company Loop ontology, condensed

cronfounder implements one ontology. Physics: **content → behavior in channels → metrics**. Epistemics: **gap → hypotheses → one funded → verdict → better bets**. Everything below is the vocabulary; `cronfounder ontology` prints the machine-readable version.

## The six nouns

The only things that exist. If a proposed object isn't one of these, it's outside the vocabulary.

| noun | where | what |
|---|---|---|
| **doctrine** | `doctrine/identity.md`, `doctrine/constitution.md` | what the business believes: ICP, problem, offer, voice; guardrails and the autonomy budget |
| **metrics** | `metrics/<name>.md` | spec (desired) vs status (observed) — the test suite of the business |
| **channels** | `channels/<id>/setup.md` (+ `skills/`) | surfaces of contact with the world |
| **content** | `content/C-YYYYMMDD-slug/` (meta.md + payload) | the payloads — the only lever the system has |
| **hypotheses** | `hypotheses/H-YYYYMMDD-slug.md` | priced, falsifiable bets; the unit of work AND of learning |
| **journal** | `journal/YYYY-MM-DD.md` (prose) + `journal/events/YYYY-MM-DD.jsonl` (facts) | append-only memory |

## The three verbs

Every touch on the world goes through a channel driver's interface:

- **pull(since)** — read signals from the surface (replies, unsubscribes, flags). Used by the watchdog.
- **push(payload)** — publish content. Only the deterministic core calls it, only for approved content, with an idempotency key.
- **subscribe()** — react to inbound events. Declared in the contract; implemented today only by the mock driver. Real channels return `E_UNSUPPORTED_CAPABILITY` — deferred, plainly.

Which binary implements these verbs is defined only in human-owned `.cronfounder/config.json` ([commands.md#drivers](commands.md#drivers)). A model can draft a channel's `setup.md`; it cannot add an executable.

## The five actors, plus the human

| actor | clock/trigger | intelligence | may |
|---|---|---|---|
| **sensors** | pulse | none — plain REST | write `metric.status` + history + journal. The ONLY writers of reality. |
| **watchdog** | reflex | none | evaluate tripwires on open watch windows; pause a hypothesis; page the human. Judges **harm only**, never success. |
| **planner** | pulse | optional narration | narrate the gap model the core computed. Emits questions, not work. |
| **strategist** | a naked gap | highest | propose 3–7 hypothesis files. The most intelligent actor has zero side-effect reach — it can only propose files the core may refuse. |
| **builders** | a funded project | per-hat | draft content / channel setup instructions into staging. Drafts stop at the gate. |

The **human** (your principal) has exactly two roles:

1. **Owner of identity and capital** (invariant IV) — accounts, credentials, `.cronfounder/config.json`, doctrine, and the autonomy ramp. Agents operate; they never own.
2. **The gate** — resolves inbox cards: funds bets, releases content, completes setup, answers decide cards. The gate can say every kind of no (`--reject`, `--choice`, `--done`), and refusals are knowledge too.

## The three clocks

| clock | default schedule | runs |
|---|---|---|
| **reflex** | every 10 minutes | `watch` — no-ops instantly when no windows are open |
| **pulse** | daily, 07:07 UTC | `sense && plan` — reality first, diff second |
| **season** | daily, 08:17 UTC | `verdict` — every overdue `review_at`, catch-up safe |

## The ten invariants

Enforced mechanically by the deterministic core. Each with what breaks without it:

| # | invariant | broken: |
|---|---|---|
| I | Agents write intentions; sensors write reality. | plans are computed against wished-for numbers — plans about a fictional company. |
| II | The journal is append-only. | history becomes editable, so nothing the company "learned" can be trusted. |
| III | Nothing side-effectful skips the gate. | an agent publishes to the world in your name while you sleep. |
| IV | Humans own identity and capital; agents own operations. | the agent owns your accounts and secrets — you can no longer fire it. |
| V | Files are canon; the ledger is derived or transactional. | deleting `company.db` costs meaning instead of minutes. |
| VI | Every task traces to a bet; every bet traces to a gap. | busywork accumulates that no number ever asked for. |
| VII | No hypothesis without kill criteria. | bets that cannot lose spend money and teach nothing. |
| VIII | One active hypothesis per metric. | two live bets on one number make every verdict unattributable. |
| IX | Verdicts come from sensors, on schedule. | the believers grade their own homework, early. |
| X | Risk gates cannot be bought. | an irreversible action ships because it was cheap and confident. |

Gate refusals cite their invariant and exit 3. They read as the product working, not as a crash.

## The hypothesis lifecycle

**State** (machine-owned, mirrors the ledger):

```
proposed → prioritized ⇄ blocked
prioritized → active            (human gate or green lane — approval is ignition)
active → measuring              (all projects done; the sensors take it from here)
active|measuring → paused       (watchdog or human; paused HOLDS the WIP slot)
paused → active|measuring       (human only — resume is never automatic)
active|measuring → validated | invalidated   (the verdict actor only)
```

**Disposition** is orthogonal to state — `open | rejected | closed_inconclusive`. Rejection is a disposition, not a state: when the gate refuses a bet set (or funds one bet, closing its siblings), the bets keep whatever state they had and get `disposition: rejected`. When a paused bet is abandoned, or an inconclusive verdict is closed without inventing a result, disposition becomes `closed_inconclusive` and the metric's WIP slot frees. No invented states, no fake verdicts.

At **activation** (funding): the WIP limit is checked at constraint level (a partial unique index — races lose politely with `E_WIP_LIMIT`), a fresh baseline reading is required and frozen (`E_NO_BASELINE` / `E_BASELINE_STALE` otherwise), `review_at = activated_at + duration_days` is computed at activation (a bet that sat proposed for two weeks doesn't lose its window), and the experiment compiles into typed projects and tasks.

## Leverage and the two gates

Every registered bet is scored with a frozen formula (deterministic board order, ties broken by id):

```
impact_norm = |claim.target_delta| / gap
cost_norm   = max(1, cost_tokens + cost_human_min × 1000)
leverage    = impact_norm × confidence / cost_norm
```

The 1 human-minute = 1000 tokens conversion is a documented constant, not a market claim. Confidence carries a source (`journal > doctrine > guess`) — the system prices honesty, not optimism.

Leverage ranks; it never overrides the two gates:

- **Readiness gate** — computed, never declared: every channel the bet needs must have its credential resolvable and its driver mapping present (probed). Not ready → the bet is `blocked` and setup cards are queued. A brilliant bet on an unbuilt channel doesn't lose points; it queues the setup and waits. Readiness is a gate, not a score input.
- **Risk gate** — `none | reversible | irreversible`. Irreversible bets can never be activated by the green lane, at any price (invariant X, `E_RISK_GATE`). A human must fund them.

**The green lane** (checked during `plan`): a bet auto-activates only if ALL hold — `cost_tokens ≤` the constitution's `auto_activation.budget_tokens` · `cost_human_min == 0` · `risk == none` · ready · its playbook's autonomy ≥ `scheduled_with_approval`. The budget defaults to **0: the green lane is OFF until a human sets it**. The activation event snapshots its own justification. The green lane funds bets — it never approves content.

## Kill criteria and the verdict algorithm

<a id="verdicts"></a>
Every hypothesis must declare `kill_criteria` at registration (invariant VII — the schema refuses `min_delta: 0`, and a kill threshold above the claimed delta is also refused: the bet could hit its claim and still "lose").

The verdict is pure code over sensor history (`ALGORITHM_V = 1`):

- **baseline** — the reading frozen at activation (id + value recorded then, never recomputed).
- **terminal** — the last reading with `measured_at ≤ review_at`.
- **delta** — direction-adjusted `terminal − baseline`.
- **validated** iff `delta ≥ |kill_criteria.min_delta|`; otherwise **invalidated**.
- **inconclusive** if no terminal reading exists, or the last one is older than the freshness window (`freshness_hours`, default 48) before `review_at`. Never auto-judged: a decide card asks the human to **extend once** (+`duration_days`) or **close inconclusive** (frees the WIP slot; no verdict recorded — a verdict computed from missing data would be an invented fact).

The verdict event freezes reading ids, values, and the algorithm version, so replay projects the recorded fact and never recomputes history. Verdicts update the playbook's `track_record`; promotion up the autonomy ramp stays a human act.

**Tripwires** (the watchdog's inputs, part of kill criteria): `{source, signal, aggregation, comparator, threshold, window_minutes, min_samples, missing_policy}`. Signals are deduped by remote id. One trip closes the window, pauses the hypothesis, and pages the human with an urgent card; resuming is human-only.

<a id="mrr"></a>
## The MRR contract (stripe_mrr sensor)

Frozen so the number means the same thing every day:

- include: subscriptions with `status == "active"` only (trialing, past_due, canceled, paused excluded)
- include: flat-rate priced items only; metered/tiered items are **excluded and journaled** as a sensor warning (never silently miscounted)
- monthly normalization: `quantity × unit_amount / interval_in_months` — year = 12, month = 1 × interval_count, week ≈ 12/52.18, day ≈ 12/365.25 — computed as `unit_amount × quantity × conversion`, integer minor units, floored per item
- currency: the single configured company currency (`config.currency`); items in other currencies are skipped and journaled
- value reported in MAJOR units (e.g. dollars) with 2 decimals
- raw subscription payloads are discarded after extraction — no customer PII in events or ledger

<a id="schemas"></a>
## Schemas — every frontmatter field

The contract between agents (who draft files) and the deterministic core (which refuses anything invalid, with the reason). Authority split per field:

- **HUMAN/AGENT-owned** — prose and intent fields. Files are canon; edits are detected via field hashes, journaled as `human_edit` events, and imported (files win).
- **MACHINE-owned** — mirrors of ledger state. The core rewrites them; **hand-edits are detected and overwritten from the ledger** on the next command (the same way `sense` overwrites a hand-edited status). The machine-owned fields across all types: `status`, `state`, `disposition`, `review_at`, `activated_at`, `baseline`, `verdict`, `readiness`, `track_record`.

All timestamps are UTC ISO-8601 strings — quote them in YAML. Slugs match `[a-z0-9][a-z0-9_-]{0,63}`.

### Metric — `metrics/<name>.md`

| field | owner | type / rules |
|---|---|---|
| `name` | human | slug; the metric's key |
| `parent` | human | slug or `null` (metric tree) |
| `unit` | human | non-empty string |
| `direction` | human | `increase` \| `decrease` (gap math is direction-adjusted) |
| `sensor.type` | human | `github_stars` \| `stripe_mrr` \| `mock` |
| `sensor.repo` | human | `owner/name` — required by `github_stars` |
| `sensor.credential_ref` | human | env var NAME, never a secret — required by `stripe_mrr` |
| `sensor.channel` | human | for `mock`: which channel's state file |
| `spec` | human | `{target, deadline, set_by, set_at, baseline_value}` or `null`. No spec → classification `unknown` |
| `status` | **MACHINE** | `{value, measured_at, written_by}` or `null`. Sensors only (invariant I) |

### Hypothesis — `hypotheses/H-YYYYMMDD-slug.md`

| field | owner | type / rules |
|---|---|---|
| `id` | agent | must match `H-YYYYMMDD-slug` AND the filename |
| `metric` | agent | slug of an existing metric (invariant VI: every bet traces to a real gap) |
| `playbook` | agent | slug of an existing playbook, or `null` |
| `claim` | agent | `{summary (≥10 chars, one falsifiable sentence), target_delta, unit}` |
| `economics` | agent | `{cost_tokens ≥0, cost_human_min ≥0, risk: none\|reversible\|irreversible, confidence: 0..1, confidence_source: journal\|doctrine\|guess}` |
| `experiment` | agent | `{duration_days: 1..60, channels: [slug, ≥1], projects: [≥1]}` — each project `{type: content\|channel_setup, channel, payload_type: text\|image\|video\|html, count: 1..20, brief}`. Channel must accept the payload type — feasibility is two lookups at design time |
| `kill_criteria` | agent | `{min_delta ≠ 0, abs(min_delta) ≤ abs(target_delta), tripwires: []}` — invariant VII, refused by the schema otherwise |
| `state` | **MACHINE** | the lifecycle above |
| `disposition` | **MACHINE** | `open` \| `rejected` \| `closed_inconclusive` |
| `review_at`, `activated_at` | **MACHINE** | set at activation |
| `baseline` | **MACHINE** | `{value, measured_at, reading_id}` frozen at activation |
| `verdict` | **MACHINE** | `{result, delta, decided_at, algorithm_v}` |

### Channel — `channels/<id>/setup.md`

| field | owner | type / rules |
|---|---|---|
| `id` | human | slug |
| `kind` | human | `x` \| `mock` |
| `identity_owner` | human | the human who owns the account — agents operate, never own (invariant IV) |
| `credential_ref` | human | env var NAME or `null` |
| `acceptance` | human | subset of `text, image, video, html` (≥1) — the acceptance matrix |
| `capabilities` | human | subset of `pull, push, subscribe` (≥1) — conformance is documented, not assumed |
| `cadence.max_per_day` | human | positive int (default 3); enforced transactionally at push |
| `driver_ref` | human | key into `.cronfounder/config.json` `drivers`, or `null`. The setup file is descriptive; the executable mapping lives only in the human-owned config |
| `readiness` | **MACHINE** | `{ready, missing[], checked_at}` — computed by probe, never declared |

### Content — `content/C-YYYYMMDD-slug/meta.md`

| field | owner | type / rules |
|---|---|---|
| `id` | agent | must match `C-YYYYMMDD-slug` AND the directory name |
| `channel` | agent | slug; must accept `payload_type` |
| `payload_type` | agent | `text` \| `image` \| `video` \| `html` |
| `payload_file` | agent | file inside the content directory (e.g. `payload.txt`) |
| `provenance` | agent | `{task, project, hypothesis, metric}` — must chain to real rows; no orphans (invariant VI) |
| `state` | **MACHINE** | `draft → pending_approval → approved → published`; only a human crosses `pending_approval → approved` |

### Playbook — `playbooks/<name>.md`

| field | owner | type / rules |
|---|---|---|
| `name` | human | slug |
| `autonomy` | **human** | `manual` \| `draft_only` \| `scheduled_with_approval` \| `auto` — granted by the human, in writing (invariant III's ramp). Green-lane eligibility needs ≥ `scheduled_with_approval` |
| `channels` | human | slugs |
| `track_record` | **MACHINE** | `{validated, invalidated, last_verdict_at}` — appended by verdicts; promotion stays human |

### Constitution — `doctrine/constitution.md` (frontmatter)

| field | owner | type / rules |
|---|---|---|
| `auto_activation.budget_tokens` | human | int ≥ 0, default **0 = green lane OFF**. One number tunes the whole system's aggressiveness |
| `never_without_approval` | human | list of things no autonomy level ever covers |

The constitution's body is free prose read by every hat on every run — tone rules, banned actions, and the autonomy ramp table live there.
