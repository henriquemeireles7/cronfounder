# cronfounder documentation

cronfounder is a **company harness** — to an agent what Kubernetes is to a container. A CLI, a repo template, and an embedded SQLite ledger that turn an AI agent into a company operator: sensors write reality, a journal remembers, gates protect your principal, and growth becomes a loop.

The deterministic core enforces ten invariants mechanically — no actor (human, model, or cron) can override them. With the clocks installed the company runs while you sleep: sensors measure, the watchdog guards, verdicts arrive on schedule from sensor data alone, and the journal gets smarter with every bet — including the failed ones.

## The loop

```
sense → plan → strategize → resolve (fund) → build → resolve (release)
  → push → watch → verdict → better bets
```

Forever.

## The 60-second demo

```sh
npx cronfounder init demo-co --demo
# pre-publish, straight from git:
# npx github:henriquemeireles7/cronfounder init demo-co --demo
```

Under a minute later you are looking at a funding card: three priced, falsifiable bets on a simulated metric, one recommended. Stub runtime, mock channel, zero credentials, zero network. Every mechanism — gaps, leverage, gates, verdicts — is the real machinery. Full walkthrough: [quickstart](./quickstart.md).

## The ten invariants

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

## The docs

**Start**

- [installation](./installation.md) — install paths, durable install for cron, runtime setup, credentials
- [quickstart](./quickstart.md) — two first-class tracks: keyless demo and real company, with honest costs

**Understand**

- [concepts](./concepts.md) — the ontology: six nouns, three verbs, five actors, three clocks, ten invariants, schemas
- [architecture](./architecture.md) — storage, runtime, and driver seams; crash consistency; versioning
- [media & computer use](./media-and-computer-use.md) — capability (the client's job) vs custody (the harness's job)

**Operate**

- [operating](./operating.md) — the operator contract for an agent running a company for a principal
- [commands](./commands.md) — every command, flag, JSON shape, exit code, cost; config + driver reference
- [errors](./errors.md) — every `E_*` code with problem, cause, fix
- [integrations](./integrations.md) — the X channel end to end, and why any MCP server can be a driver
- [harnesses](./harnesses.md) — mount cronfounder in Claude Code, Cowork, Codex, Devin, OpenClaw, Hermes, Cursor

## Agents: theory → practice

Read [concepts](./concepts.md) → [operating](./operating.md) → [commands](./commands.md) → [errors](./errors.md), in that order, top to bottom. The path is self-contained: the vocabulary and invariants first, then your contract as operator, then every command with its flags, JSON envelope, and exit codes, then every failure code with its fix. Nothing else is required to operate the CLI.

Machine access: this site ships [llms.txt](./llms.txt) and [llms-full.txt](./llms-full.txt), plus a raw markdown twin of every page (append `.md` to any page URL). Offline, `cronfounder ontology --json` prints the machine appendix.
