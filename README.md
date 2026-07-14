# cronfounder

**An open-source company harness: the CLI an AI agent mounts to run a real company — sensors write reality, a journal remembers, gates protect your money.**
To an agent, cronfounder is what Kubernetes is to a container: the environment that turns capability into an operated, supervised, always-on system.

[![npm](https://img.shields.io/npm/v/cronfounder)](https://www.npmjs.com/package/cronfounder)
[![ci](https://github.com/henriquemeireles7/cronfounder/actions/workflows/ci.yml/badge.svg)](https://github.com/henriquemeireles7/cronfounder/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/cronfounder)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/cronfounder)](LICENSE)

Docs: [quickstart](docs/quickstart.md) · [concepts](docs/concepts.md) · [operator contract](docs/operating.md) · [commands](docs/commands.md) · [mount in your harness](docs/harnesses.md)

## Try it — 60 seconds, zero keys, zero network

```sh
npx cronfounder init demo-co --demo
```

Under a minute later you are looking at your first funding card:

```
✓ scaffold     demo-co (runtime: stub)
✓ metric       demo_signups: 12 → 100 in 30 days (mock sensor)
✓ sense        1 reading(s) — reality is in
✓ strategize   3 bet(s) on demo_signups

The loop just closed for the first time. One decision is waiting:

R-1 · approve_hypothesis
  what:     fund ONE bet to close the demo_signups gap (88 signups short)
  choices:
    H-…-founder-story-thread — [recommended] +27 signups in 14 days
      (30000 tokens + 10 human-min · risk reversible · confidence 0.35)
    H-…-comparison-page      — +18 signups in 10 days
    H-…-reply-guy-sprint     — +9 signups in 7 days
  → cronfounder resolve R-1 --approve | --choice <H-id> | --reject
```

Stub runtime, mock channel, zero credentials — but every mechanism is the real machinery: gaps, priced bets, gates, watch windows, verdicts. Approve the card and keep going:

```sh
cd demo-co
npx cronfounder resolve R-1 --approve   # approval is ignition: projects compile
npx cronfounder build                   # drafts arrive — and stop at the gate
npx cronfounder inbox                   # release them, one card each
```

Full demo track through a verdict (~5 min, 0 tokens): [docs/quickstart.md](docs/quickstart.md).

## Who this is for

- **You, the human:** a founder or builder who wants an agent running growth experiments — every bet priced and falsifiable, every publish behind your approval, every verdict computed from sensor data instead of vibes.
- **You, the agent:** a Claude Code / Codex / Devin / OpenClaw / Hermes / Cursor-class operator. Read [AGENTS.md](AGENTS.md), then `cronfounder ontology --json`. Every command takes `--json`; the exit codes are the contract.

## Paste this to your agent

```
Mount cronfounder — a company harness — and operate my company inside it.

1. Install it: npm install -g cronfounder   (needs Node >= 22.13)
2. Read AGENTS.md in the cronfounder repo (or `cronfounder ontology --json`
   offline) — it links to the operator contract and the machine vocabulary.
3. Initialize my company (ask me for a directory name, website URL and GitHub
   repo; --yes so you never hang on a prompt):
     cronfounder init <dir> --yes --url <my-site> --repo <owner/name>
4. The ten invariants are enforced mechanically. Exit code 3 means a gate
   refused by design — relay it to me; never work around it.
5. Relay every card from `cronfounder inbox --json` to me with your
   recommendation, then execute my answer with `cronfounder resolve`. Never
   resolve cards on your own authority unless doctrine/constitution.md grants
   it in writing — and then always pass --as agent:<your-name>.
```

## Install

```sh
npm install -g cronfounder    # canonical — durable, cron-ready
npx cronfounder …             # no-install trial (fine for everything except cron install)
```

One prerequisite: **Node >= 22.13** (the ledger is `node:sqlite` — zero native deps, nothing to compile). `cronfounder doctor` verifies everything else that silently kills the loop.

Upgrade: `npm update -g cronfounder`. Uninstall: `cronfounder cron uninstall` (removes the clocks), then `npm rm -g cronfounder`; your company directory is plain files + git, delete it whenever.

Contributor / from-git install: [docs/installation.md](docs/installation.md).

## Your first real company

```sh
cronfounder init my-co --url https://your-site.com --repo you/your-repo
```

With [Claude Code](https://claude.com/claude-code) installed and authenticated, onboarding reads your artifacts, drafts doctrine for your confirmation (never auto-canon), wires a `github_stars` metric, senses it, computes the gap, and ends at your first funding card. From there:

```sh
cd my-co
cronfounder resolve R-1 --approve   # fund the recommended bet
cronfounder build && cronfounder inbox
cronfounder resolve R-2 --approve && cronfounder push
cronfounder cron install            # pulse daily · reflex 10min · season daily
```

The clocks run the company while you sleep: sensors measure, the watchdog guards, verdicts arrive on schedule from sensor history alone. Honest time and token costs: [docs/quickstart.md](docs/quickstart.md#costs).

## The contract (for agents and scripts)

- Every command takes `--json`: exactly one machine envelope on stdout, all progress on stderr.
- **Exit codes are the API:** `0` ok · `1` error · `2` usage · `3` gate refused (the invariant is named — this is the product working, not a crash) · `4` busy/locked (retry).
- Every error carries a stable `E_*` code with problem/cause/fix ([docs/errors.md](docs/errors.md)).
- Machine bootstrap, offline: `cronfounder ontology --json`. On the web: [llms.txt](site/llms.txt). In your harness: [docs/harnesses.md](docs/harnesses.md) — Claude Code, Claude Cowork, Codex/ChatGPT, Devin, OpenClaw, Hermes, Cursor.

## The ten invariants

The deterministic core enforces these mechanically. No actor — human, model, or cron — can override them.

> I. Agents write intentions; sensors write reality.
> II. The journal is append-only.
> III. Nothing side-effectful skips the gate.
> IV. Humans own identity and capital; agents own operations.
> V. Files are canon; the ledger is derived or transactional.
> VI. Every task traces to a bet; every bet traces to a gap.
> VII. No hypothesis without kill criteria.
> VIII. One active hypothesis per metric.
> IX. Verdicts come from sensors, on schedule.
> X. Risk gates cannot be bought.

## Commands

The six you use daily:

| command | one line |
|---|---|
| `init [dir]` | scaffold a company and run onboarding; resumable; ends at the first funding card |
| `inbox` | what needs a human — schema'd cards, each with its exact resolve command |
| `resolve <R-id>` | `--approve` \| `--choice <key>` \| `--reject` \| `--done` — approval is ignition |
| `build` | run the bound builder per project; drafts stop at the gate |
| `push [id]` | publish approved content; opens a watch window |
| `doctor` | check everything that silently kills the loop |

Seventeen commands total — `sense`, `plan`, `strategize`, `board`, `watch`, `verdict`, `rebuild`, `run`, `cron`, `ontology` and friends: [docs/commands.md](docs/commands.md).

## What it is not (yet)

Deferred, plainly: real channels beyond X and mock (`subscribe` is declared in the ontology, implemented only by the mock driver), chat-surface approvals like Telegram (the inbox is CLI + `inbox/*.md` + static HTML today), schema/event migration tooling (seeds ship now, tooling at v0.2.0), and autonomy above the green lane. A sleeping laptop misses ticks — catch-up runs overdue work on the next tick, but a tiny server is the honest home for a company.

## Docs

- [docs/installation.md](docs/installation.md) — install paths, durable install for cron, runtime setup, credentials
- [docs/quickstart.md](docs/quickstart.md) — two first-class tracks: keyless demo and real company, with honest costs
- [docs/concepts.md](docs/concepts.md) — the ontology: six nouns, three verbs, five actors, three clocks, ten invariants
- [docs/commands.md](docs/commands.md) — every command, flag, JSON shape, exit code, cost; config + driver reference
- [docs/operating.md](docs/operating.md) — the operator contract for an agent running a company for a principal
- [docs/harnesses.md](docs/harnesses.md) — mount cronfounder in Claude Code, Cowork, Codex, Devin, OpenClaw, Hermes, Cursor
- [docs/errors.md](docs/errors.md) — every `E_*` code with problem, cause, fix
- [docs/architecture.md](docs/architecture.md) — storage, runtime, and driver seams; crash consistency; versioning
- [site/](site/) — the landing page, the hosted ontology, and llms.txt as served on the web

## Status

v0.1.x — the loop closes and it learns. The dogfood company in [company/](company/) is cronfounder running on cronfounder: a real sensed metric, a live journal, verdicts on schedule. That's the proof, not a promise.

## License

MIT
