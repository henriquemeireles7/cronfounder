# Harnesses — mount cronfounder in your agent

cronfounder ships two artifacts every modern agent harness already reads: an `AGENTS.md` operator contract (emitted into every company dir by `init`) and one Agent Skills–standard skill at `.agents/skills/cronfounder/`.
The rows below are only where each harness looks and how to install the skill when it doesn't read `.agents/` directly — the pair covers everything.

## what each harness reads

| harness | instructions file | skill discovery | install recipe |
|---|---|---|---|
| Claude Code | `CLAUDE.md` (imports `@AGENTS.md`) | `.claude/skills/` (symlinked entries followed) | already wired in the repo + template — nothing to do |
| Claude Cowork | (the skill carries it) | upload only — Customize > Skills | upload the skill ZIP (below) |
| Codex / ChatGPT | `AGENTS.md` | `.agents/skills/`, `~/.agents/skills/` | native; or `$skill-installer` |
| Devin | `AGENTS.md` + Knowledge | `.agents/skills/` | native; commit the repo / company dir |
| OpenClaw | workspace instructions | `.agents/skills/`, `~/.agents/skills/` | native; or ClawHub (below) |
| Hermes | `AGENTS.md` | `~/.hermes/skills/` | Skills Hub (agentskills.io) or `hermes claw migrate` |
| Cursor | `AGENTS.md` | `.agents/skills/`, `~/.agents/skills/` | native; commit the repo / company dir |

## Claude Code

Reads `CLAUDE.md`, not `AGENTS.md` — so both the repo and every scaffolded company ship a `CLAUDE.md` whose single line is `@AGENTS.md` (the official import bridge). The skill lives at `.agents/skills/cronfounder/` with a symlink from `.claude/skills/cronfounder` (Claude Code follows symlinked skill entries). Nothing to install: open the repo, or a company dir created by `cronfounder init`, and both the contract and the skill are live. Invoke it as `/cronfounder`, or let Claude match it on the description.

## Claude Cowork

Cowork installs skills by upload, not filesystem discovery — the same `SKILL.md` folder. Zip the skill folder:

```sh
cd .agents/skills && zip -r cronfounder-skill.zip cronfounder
```

In Cowork: Customize > Skills > `+` > `+ Create skill` > `Upload a skill` > upload `cronfounder-skill.zip` (the ZIP must contain the `cronfounder/` folder with `SKILL.md` at its root, or the upload is rejected). Requires code execution enabled; Team/Enterprise owners can publish it to the org directory under Organization settings > Skills.

Honest caveat: a Cowork session may not have a durable Node environment or cron. A Cowork operator should drive a machine where `cronfounder` is installed, or work the `--dry-run` / `run import` lane — it needs no runtime and no API key (see the skill's `reference.md`). The clocks (`cron install`) need a durable clone + `npm link`, so a laptop or server owns them, not Cowork.

## Codex / ChatGPT

Codex (CLI, IDE, cloud, desktop) reads `AGENTS.md` at the git root and every parent down to cwd (32 KiB combined cap — the company contract is well under it), and skills from `$REPO_ROOT/.agents/skills`, `$CWD/.agents/skills` (and parents), and `~/.agents/skills`. Committing the repo or a company dir is enough. Otherwise install from the curated index with `$skill-installer`, or unzip the skill folder into `~/.agents/skills/`. Invoke with `$cronfounder`, or let Codex match the description. ChatGPT Work/Business connectors and the Apps SDK are MCP in-chat apps — the wrong shape for driving a local CLI; use Codex.

## Devin

Reads `AGENTS.md` natively before coding, and skills from `.agents/skills/` (it also scans `.devin/`, `.github/`, `.claude/`, `.cursor/`, `.codex/` `…/skills/`). Commit the repo or the company dir to a connected repo and both are discovered at session start; invoke with `@skills:cronfounder`. Optional: add one Knowledge entry — "this directory is a cronfounder company; read AGENTS.md and invoke the cronfounder skill" — and a copy-paste "operate a cronfounder company" Playbook (the README onboarding block).

## OpenClaw

Skills are the primary surface, discovered from `<workspace>/.agents/skills`, `~/.agents/skills`, and `~/.openclaw/skills` (highest wins). The skill's `metadata.openclaw` block declares `requires.bins: [cronfounder, git]` and a node install, so OpenClaw's gating and security analysis pass. Commit it to the workspace, or install from ClawHub:

```sh
openclaw skills install @henriquemeireles7/cronfounder   # or git:henriquemeireles7/cronfounder@main, or a local path
```

Add `--global` to install into `~/.openclaw/skills`.

## Hermes (Nous Research)

Honors `AGENTS.md` as workspace instructions and reads agentskills.io-standard skills from `~/.hermes/skills/`. Install from the Skills Hub (agentskills.io), or import an OpenClaw install with `hermes claw migrate` (lands in `~/.hermes/skills/openclaw-imports/`). Invoke with `/cronfounder`. Hermes's own scheduler pairs naturally with `cronfounder cron print`.

## Cursor

Reads `AGENTS.md` at root and nested (more specific wins), and skills from `.agents/skills/`, `.cursor/skills/`, `~/.agents/skills/`, `~/.cursor/skills/`. Commit the repo or company dir — both are native. `.cursor/rules/*.mdc` are unnecessary here; they would only duplicate `AGENTS.md`.

---

Everything else the `AGENTS.md` + skill pair already covers: the standard is read natively by 28+ tools (Jules, Factory, GitHub Copilot, Windsurf, Amp, Zed, Warp, Aider, goose, JetBrains Junie, …). If your harness reads `AGENTS.md` or an Agent Skills `SKILL.md`, cronfounder mounts with no per-harness work.
