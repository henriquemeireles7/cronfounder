# Changelog

## 0.2.0 — 2026-07-14

Onboarding, security, harness reach, and the first real channel.

### Added
- **X (Twitter) channel, end to end.** Posting via a bundled stdio MCP server (`create_post`, OAuth 1.0a signed with `node:crypto`, zero new deps); metrics via the `x_post_metrics` sensor (`public_metrics` over an app-only bearer). Setup, costs, and failure mapping in [docs/integrations.md](docs/integrations.md).
- **Mount in your harness.** One `AGENTS.md` (repo root + every company dir) and one Agent Skills–standard skill at `.agents/skills/cronfounder/` (symlinked into `.claude/skills/` for Claude Code) cover Claude Code, Claude Cowork, Codex/ChatGPT, Devin, OpenClaw, Hermes, and Cursor. See [docs/harnesses.md](docs/harnesses.md).
- **Docs site (VitePress)** over the existing docs, deployed alongside the landing page, with `llms.txt` / `llms-full.txt` / raw `.md` twins for agents.
- **`cron uninstall`** — remove the clocks as cleanly as `cron install` adds them.
- **`npm run sim`** — a deterministic company with 15 days of history (funded bet → published post → readings → computed verdict) for developing against realistic data.
- **Doctrine docs** on media & computer use (capability vs custody) and integrations (MCP platforms).
- Contribution files: CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue/PR templates; label-triggered repro workflow and a weekly published-package health check.

### Changed
- **README rewritten npx-first**: the 60-second keyless demo above the fold with expected output, badges, who-it's-for, the exit-code contract as a named section.
- **`doctor` gained a third state**: `○` setup pending (an unwired channel, uninstalled clocks) versus `✗` broken. The keyless demo now exits 0 cleanly.
- **`init` next-step hints** are invocation-aware (`npx` vs global) and `cd`-aware, and name the actual funding-card id; `init` also raises its own default `github_stars` target when sensing shows it is already met.
- **TypeScript 7** (the Go-native compiler) — ~4× faster typecheck, drop-in.
- CI split into a fast single-job PR lane with the full OS×Node matrix and packaged-tarball acceptance post-merge.

### Security
- **Fixed a path-traversal (arbitrary file write) via model-authored `payload_file`** — containment enforced at the schema and at every read/write site (`E_PATH_ESCAPE`).
- Crontab lines are POSIX-shell-quoted; `.cronfounder/env` is created `0600`; least-privilege `permissions:` on workflows; the `agent:repro` workflow runs read-only tools on untrusted issue bodies.

### Removed
- The maintainer's private `.claude/skills` tooling no longer ships in the repo.

## 0.1.0 — 2026-07-13

Initial release: the deterministic company loop — ledger, events, gates, sensors, the runtime seam, and the CLI. The loop closes and it learns.
