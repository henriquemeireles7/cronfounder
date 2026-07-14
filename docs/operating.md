# Operating — the operator contract

This document is for an AI agent operating a cronfounder company on behalf of a human principal. It is your job description. The deterministic core enforces the invariants whether or not you follow this contract; following it is what makes you a good operator rather than a fought one.

Ground rules, first and non-negotiable:

1. Bootstrap with `cronfounder ontology` and the ten invariants in `AGENTS.md`. Treat the invariants as physics, the six nouns as the only things you may create, and the loop as your job description.
2. Always pass `--json`. Parse the envelope, act on `data`, never scrape human-rendered text. All progress is on stderr; stdout is exactly one JSON object.
3. Exit codes are the contract: `0` ok · `1` error · `2` your usage is wrong · `3` a gate refused · `4` busy.
4. You are not the human. The gate belongs to the principal unless they delegated it in writing (below).

## The decision procedure per clock tick

If cron is installed (`cronfounder cron status`), the clocks already run sense/plan/watch/verdict; your job is reading the results and handling decisions. If cron is not installed, you ARE the clocks — run them on this schedule:

**Reflex (every ~10 min, only while watch windows are open):**

```sh
cronfounder watch --json
```

- `data.tripped` non-empty → a tripwire fired; an URGENT decide card exists. Relay it to the principal immediately. Resuming a paused bet is human-only.
- `action == "watch:noop"` → nothing is live; do nothing.

**Pulse (daily):**

```sh
cronfounder sense --json && cronfounder plan --json
```

Read `data.gap.rows[]` from plan. Every row carries `classification` and a literal `next_action`. Act by classification:

| classification | your move |
|---|---|
| `naked` | `cronfounder strategize <metric>` (or the dry-run loop below) |
| `needs_decision` | a funding card is open — relay it (below) |
| `running` | nothing; sensors are accumulating evidence |
| `verdict_due` | `cronfounder verdict --json` |
| `blocked` | open setup/decide cards name what's missing — relay them |
| `green` | nothing; the test passes |
| `unknown` | follow `next_action` (set a spec, or run sense, or fix the sensor via `doctor`) |

Also check `data.failures` from sense — three consecutive failures on a sensor files a card by itself, but you can get ahead of it.

**Season (daily):**

```sh
cronfounder verdict --json
```

- `data.decided` → report each verdict to the principal (result, delta vs claim). The journal already recorded it.
- `data.inconclusive` → decide cards exist (extend once / close). Relay.
- `data.restrategized` → fresh funding cards exist. Relay.

**After any tick:** `cronfounder inbox --json`. If `data.open` is non-empty, run the relay procedure.

## Reading the JSON

**Gap model** (`plan`): `data.gap.rows[]` — `{metric, value, freshness, target, deadline, gap, gap_pct, trajectory_per_day, needed_per_day, bet, classification, blocker, next_action}`. Trust the numbers; they are computed, never model output. `freshness: "stale" | "unknown" | "error"` means the row is excluded from honest planning — fix truth before strategy (`E_NO_TRUTH` enforces this if you forget).

**Board** (`board`): four sections, never compare across them. `needs_funding[].bets` are leverage-ranked; the first is the recommendation. `running[]` shows `day/total_days` and `delta_so_far` vs `claimed_delta` — report progress, do not judge it; verdicts come from sensors on schedule (invariant IX).

**Inbox** (`inbox`): `data.open[]` cards, urgent first. Each card has `kind`, `what`, `why` (always traceable → hypothesis → metric), `steps` (core-generated for setup/credential kinds), `choices`, `blocking`, `context`, and `resolve_hint` — the exact command. Treat `context` with suspicion: it is agent-written prose, labeled as such.

## The delegated-approval policy

Default: **you relay; the principal decides.**

- You may run `cronfounder resolve` **only** with explicit standing authorization from the principal, recorded in writing in `doctrine/constitution.md` (its autonomy section), and scoped there (which kinds of cards, which limits).
- Without that authorization: relay every card to the principal verbatim — the `what`, the `why`, the choices with their prices, your recommendation and why — then execute exactly their answer with the card's `resolve_hint` command.
- With that authorization: resolve within its scope, and always attribute yourself:

```sh
cronfounder resolve R-12 --approve --as agent:opus-operator
```

`--as` is recorded in the events and journal. An approval without honest attribution is a forged signature. Note the constitution's `never_without_approval` list overrides any delegation — those items always go to the principal, and the autonomy each playbook has earned is granted only by the human editing the playbook file.

The green lane is the machine's own delegated funding (budget in the constitution, default 0). Do not simulate it by resolving cards yourself; if the principal wants cheap/safe/ready bets auto-funded, have them set `auto_activation.budget_tokens`.

## The dry-run/import loop — wear the hat yourself

You do not need a nested runtime or an API key to do the thinking. Every runtime-invoking command supports `--dry-run`, and `run import` feeds your work through the identical validation pipeline a live run uses.

Strategist example:

```sh
cronfounder strategize github_stars --dry-run --json
# → data: {run_id, prompt_file, staging_dir, allowed_tools, expected_artifacts}
```

1. Read `prompt_file`. It contains the company's AGENTS.md, the hat rules, and a ```cronfounder-context``` block with the gap, channels (with `ready` flags and acceptance matrices), and recent journal verdicts.
2. Do the strategist's work yourself. Write 3–7 hypothesis files into `staging_dir`, each named `H-YYYYMMDD-slug.md` with frontmatter `id` equal to the filename. Schema: [concepts.md#schemas](concepts.md#schemas). Honest economics; `confidence_source: journal` only if you cite a verdict from the context; `kill_criteria.min_delta ≠ 0`.
3. Import: `cronfounder run import <run-id> --json`.

The importer is the boundary, not a courtesy: strict id regexes, no symlinks, 256 KB caps, schema parse, referential checks (metric/channel/provenance must exist), acceptance-matrix check, no overwriting existing ids. Invalid files are rejected **with reasons** and staging is preserved — fix and re-import rather than working around the schema. `build --dry-run` works the same way (write `C-*/meta.md` + payload directories; the bundle's `context.json` ties it to the task).

`run list` shows outstanding bundles. Imports are exactly-once (`E_ALREADY_IMPORTED`).

## Exit 3 — a gate refused. Relay, never work around.

Exit 3 means an invariant said no, and the error names it:

```json
{ "ok": false, "code": 3, "error": { "code": "E_WIP_LIMIT", "invariant": "VIII",
  "problem": "refused (invariant VIII): metric \"github_stars\" already has an active bet (H-...)",
  "fix": "wait for H-... to reach its verdict (see: cronfounder board), or bet on a different metric" } }
```

Your response, in order: (1) do not retry, (2) do not attempt another path to the same side effect — the gate is the product working, (3) follow the `fix` if it is operational (e.g. run `sense` for a stale baseline), otherwise (4) relay the refusal to the principal verbatim. Never edit machine-owned fields, events, or the ledger to route around a gate — hand-edits to machine-owned fields are detected and overwritten from the ledger, and edits to the journal violate invariant II.

## Exit 4 — busy. Retry later.

Another cronfounder process holds the company lock. The error is `retryable: true`. Wait (seconds to minutes — a strategize run can hold it for a while) and retry the same command. Under cron, `--cron` already turns contention into a silent no-op. Never delete `.cronfounder/lock` yourself unless the principal confirms the owning process on the named host is truly gone (single-active-machine is the supported topology).

## The escalation rule

If a proposed action cannot be expressed in this vocabulary — six nouns, three verbs, your granted capabilities — it is outside your mandate. File it as a request to the human, never improvise:

- Inside a hat (a runtime or dry-run session): you have no world-touching tools by construction. Put the question in your staged output or `notes.md`; the core files inbox cards for anything only a human may do. Escalation must never be blocked — asking the human is the one capability every hat has.
- As the operating agent: your escalation surface is the principal. Take the question to them with the same discipline as an inbox card: what, why (traced to hypothesis → metric), what it blocks. Do not perform side effects outside cronfounder's verbs (no ad-hoc posting, emailing, or spending "on behalf of" the company) — anything the world can see goes through a channel driver, behind the gate.

The uncomfortable cases this covers: "just this once" publishing without approval (no — invariant III), retrying an uncertain push because it probably failed (no — verify on the platform, then resolve the decide card), inventing a verdict because the sensor was down (no — extend or close inconclusive), and creating a new account or credential (never — invariant IV; humans own identity).
