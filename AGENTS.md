# AGENTS.md — the cronfounder repo

This repo is **cronfounder**, a company harness: a Node >= 22.13 ESM TypeScript CLI that an AI agent mounts to operate a company. Two distinct agent roles touch it — be sure which one you are:

- **Operating a company** (a directory created by `cronfounder init`): your contract is [docs/operating.md](docs/operating.md); the company directory has its own `AGENTS.md` scaffolded into it. Bootstrap vocabulary offline: `cronfounder ontology --json`. This file is not your contract.
- **Developing cronfounder itself** (this repo): read on.

## Setup and verify

```sh
npm ci                # install (Node >= 22.13 required — node:sqlite)
npm run build         # tsc → dist/ (TypeScript 7 native, ~sub-second)
npm test              # build + vitest: all tests must pass
npm run typecheck     # tsc --noEmit
npx vitest run test/unit.core.test.ts   # one file while iterating
```

Run the built CLI without reinstalling: `node dist/cli.js <command>`. A full keyless loop to verify behavior end-to-end:

```sh
node dist/cli.js init /tmp/check-co --demo --yes --quiet
cd /tmp/check-co && node <repo>/dist/cli.js inbox --json
```

Need realistic data, not a blank scaffold? `npm run sim` builds `./sim-co` (gitignored): 15 days of history — a funded bet, a published post, sensor readings, a computed verdict. Deterministic; re-run to reset.

## Layout

- `src/core/` — the deterministic machinery: ledger (node:sqlite), events, gates, gap model, locks. No model calls ever.
- `src/commands/` — one file per CLI verb; thin, everything terminal goes through `Out` (src/output.ts).
- `src/sensors/` — the only writers of reality (invariant I). `src/runtime/` — the adapter seam to Claude Code/stub, and the staging import boundary (a trust boundary — treat it adversarially).
- `src/render/` — terminal + static HTML views. `templates/company/` — what `init` scaffolds. `test/` — vitest; `test/helpers.ts` builds throwaway companies.
- `company/` — the live dogfood company (cronfounder running on cronfounder). Treat as production data, not a fixture.

## The contract you must not break

- Exit codes are semver-stable API: `0` ok · `1` error · `2` usage · `3` gate refused (names its invariant) · `4` busy/locked.
- `--json` prints exactly one envelope `{v, ok, code, action, data|error}` on stdout; all progress goes to stderr.
- Errors are `CronfounderError` with a stable `E_*` code + problem/cause/fix, registered in [docs/errors.md](docs/errors.md).
- The ten invariants in the README are design constraints, not suggestions. If a change makes an invariant bypassable, the change is wrong.

## Boundaries

- **Always:** run `npm test` before claiming done; keep diffs small; match the repo voice (lowercase, terse, honest); add a regression test with any behavior change.
- **Ask first:** new runtime dependencies (the count is deliberately ~5); schema or event-shape changes (they need migration seeds); anything touching `company/` (live data); publishing or tagging.
- **Never:** commit secrets (credentials are env-var references by design); write to the ledger except through `Store`; let model-authored content reach a shell, a path join, or HTML without going through the existing validation/escaping; weaken the staging import boundary.

## Machine bootstrap

`cronfounder ontology --json` (offline) · [site/llms.txt](site/llms.txt) (web) · [docs/harnesses.md](docs/harnesses.md) (mount in Claude Code, Cowork, Codex, Devin, OpenClaw, Hermes, Cursor).
