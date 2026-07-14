# cronfounder

**A company harness — to an agent what Kubernetes is to a container.**
A CLI, a repo template, and an embedded SQLite ledger that turn an AI agent into a company operator.
Sensors write reality, a journal remembers, gates protect your principal, and growth becomes a loop.

The loop: `sense → plan → strategize → resolve (fund) → build → resolve (release) → push → watch → verdict → better bets`. Forever.

---

## Paste this to your agent

If you run a Claude Code / OpenClaw-class agent, this block is the whole onboarding:

```
Mount cronfounder — a company harness — and operate my company inside it.

1. Install it (needs Node >= 22.13):
     git clone https://github.com/henriquemeireles7/cronfounder && cd cronfounder && npm install && npm run build && npm link
2. Read the repo before acting: README.md, docs/operating.md (your operator
   contract), docs/concepts.md, and run `cronfounder ontology` for the
   machine vocabulary.
3. Initialize my company (ask me for the directory name, my website URL and
   GitHub repo; use --yes so you never hang on a prompt):
     cronfounder init <dir> --yes --url <my-site> --repo <owner/name>
   To evaluate the harness first without any credentials:
     cronfounder init demo-co --demo
4. Honor the ten invariants in AGENT.md as non-negotiable. Exit code 3 means
   a gate refused by design — relay it to me; never work around it.
5. Relay every card from `cronfounder inbox --json` to me with your
   recommendation, then execute my answer with `cronfounder resolve`. Do not
   resolve cards on your own authority unless I have granted you standing
   authorization in writing in doctrine/constitution.md — and then always
   pass --as agent:<your-name>.
```

## Install

**Prerequisites**

- Node **>= 22.13** — the embedded ledger uses `node:sqlite`, flag-free since 22.13. Zero native dependencies; nothing to compile.
- git (for the clone path, and so your company directory is version-controlled).
- Optional: [Claude Code](https://claude.com/claude-code), installed and authenticated, if you want the real runtime. The demo needs nothing.

**Path A — clone and link (durable; required before `cron install`):**

```sh
git clone https://github.com/henriquemeireles7/cronfounder && cd cronfounder && npm install && npm run build && npm link
```

**Path B — straight from git via npx (builds via `prepare`):**

```sh
npx github:henriquemeireles7/cronfounder init my-co --demo
```

`npx cronfounder` becomes the canonical command once the package is published to npm (the one human TODO — humans own accounts, invariant IV). Note: the npx cache is ephemeral, so `cron install` refuses to point the clocks at it; use Path A for a durable install. Details: [docs/installation.md](docs/installation.md).

### The 60-second demo (no keys, real loop)

```sh
cronfounder init demo-co --demo && cd demo-co
```

Under a minute later you are looking at a funding card: three priced, falsifiable bets on a simulated metric, one recommended. Stub runtime, mock channel, zero credentials, zero network. Every mechanism — gaps, leverage, gates, verdicts — is the real machinery.

### The real track

```sh
cronfounder init my-co --url https://your-site.com --repo you/your-repo
```

With Claude Code installed and authenticated, onboarding reads your artifacts, drafts doctrine for your confirmation, wires a `github_stars` metric, senses it, computes the gap, and ends at your first funding card. Full walkthrough with honest time and token costs: [docs/quickstart.md](docs/quickstart.md).

## Your first loop

```sh
cronfounder init demo-co --demo   # scaffold + sense + plan + strategize → funding card
cd demo-co
cronfounder inbox                 # the funding card: 3 bets, one recommended
cronfounder resolve R-1 --approve # approval is ignition: projects + tasks compile
cronfounder build                 # the builder drafts content; drafts stop at the gate
cronfounder inbox                 # approve_content cards, one per draft
cronfounder resolve R-2 --approve # release one draft
cronfounder push                  # publish approved content; a watch window opens
cronfounder cron install          # pulse 07:07 UTC · reflex every 10 min · season 08:17 UTC
```

From here the clocks run the company: sensors measure, the watchdog guards, verdicts arrive on schedule from sensor data alone, and the journal gets smarter with every bet — including the failed ones.

## Commands

| command | one line |
|---|---|
| `init [dir]` | scaffold a company and run onboarding; resumable; ends at the first funding card |
| `doctor` | check everything that silently kills the loop: node, runtime auth, credentials, clocks |
| `sense` | run every sensor — the only writer of reality (invariant I); no model calls |
| `plan` | diff spec vs status → deterministic gap report; green-lane check; optional narration |
| `board` | the hypothesis pipeline: needs-funding → running → blocked → verdicts (+ static HTML) |
| `inbox` | what needs a human — schema'd cards, each with its exact resolve command |
| `resolve <R-id>` | resolve a card: `--approve` \| `--choice <key>` \| `--reject [--reason]` \| `--done` |
| `approve <R-id>` | alias of `resolve --approve`; approval is ignition |
| `strategize <metric>` | one naked gap → 3–7 priced, falsifiable bets + one funding card |
| `build` | run the bound builder per project; drafts stop at the gate as approve_content cards |
| `push [content-id]` | publish approved content; opens a watch window; uncertain deliveries never auto-retry |
| `watch` | watchdog: evaluate tripwires on open windows; pause + page on harm; judges harm only |
| `verdict` | season clock: compute every overdue verdict from sensor history alone |
| `rebuild` | reconstruct company.db from files + journal (invariant V, executable) |
| `run list` / `run import <run-id>` | the dry-run loop: an operating agent wears the hat itself, then imports |
| `cron print\|install\|status` | the three clocks as crontab lines; never installs silently |
| `ontology` | print the machine appendix (the ontology as JSON) — offline agent bootstrap |

Every command takes `--json` (envelope on stdout, all progress on stderr). Exit codes are the contract: `0` ok · `1` error · `2` validation/usage · `3` gate-refused (invariant named) · `4` busy/locked (retryable). Full reference: [docs/commands.md](docs/commands.md).

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

A refusal citing an invariant (exit 3) is the product working, not a crash.

## Docs

- [docs/installation.md](docs/installation.md) — install paths, durable install for cron, runtime setup, credentials
- [docs/quickstart.md](docs/quickstart.md) — two first-class tracks: keyless demo and real company, with honest costs
- [docs/concepts.md](docs/concepts.md) — the ontology: six nouns, three verbs, five actors, three clocks, ten invariants, schemas
- [docs/commands.md](docs/commands.md) — every command, flag, JSON shape, exit code, cost; config + driver reference
- [docs/operating.md](docs/operating.md) — the operator contract for an agent running a company for a principal
- [docs/errors.md](docs/errors.md) — every `E_*` code with problem, cause, fix
- [docs/architecture.md](docs/architecture.md) — storage, runtime, and driver seams; crash consistency; versioning
- [site/](site/) — the landing page and the ontology, as served on the web

## Status

v0.1.0 — the loop closes and it learns. See the dogfood company in `company/`: cronfounder running on cronfounder, with a real sensed metric and a live journal.

Deferred, plainly: `subscribe` on real channels (declared in the ontology, implemented only by the mock driver), npm publish (`npx cronfounder` post-publish), schema/event migration tooling (seeds shipped now, tooling at v0.2.0), and chat-surface approvals such as Telegram (the inbox is CLI + `inbox/*.md` + static HTML today).

## License

MIT
