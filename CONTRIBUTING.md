# Contributing

cronfounder is maintained by one person. Small, focused PRs get reviewed fast; large ones sit.

## Dev setup

Node **>= 22.13** is required — the embedded ledger uses `node:sqlite`, flag-free since 22.13.

```sh
git clone https://github.com/henriquemeireles7/cronfounder && cd cronfounder
npm ci
npm run build
npm test
```

`npm test` runs the build first, then the full vitest suite (47 tests covering M0-M6, including a dogfood company: cronfounder running on cronfounder).

Run one file while iterating:

```sh
npx vitest run test/unit.core.test.ts
```

## Repo map

| path | what lives there |
|---|---|
| `src/core/` | the deterministic machinery — ledger, events, gap, scan, states, lock, verdict. No model calls, no I/O beyond files/db. |
| `src/commands/` | the CLI surface — one file per verb (`init`, `sense`, `plan`, `build`, `resolve`, ...), thin over `src/core`. |
| `src/sensors/` | reality writers — the only code allowed to observe the outside world (invariant I). |
| `src/runtime/` | the adapter seam — hats, prompts, staging, the Claude driver, and the stub used in tests/demo. Models propose here; the core disposes. |
| `src/render/` | terminal and static-HTML views over the same viewmodel. |
| `templates/company/` | the scaffold `init` copies into a new company directory. |
| `test/` | vitest suite: unit, guards, greenlane, and the e2e loop test. |

## The ten invariants are non-negotiable

Every change has to survive contact with the ten invariants in [README.md](README.md#the-ten-invariants). They are design constraints, not suggestions — a PR that routes around one (e.g. a sensor that writes intentions, a mutation that skips the gate, a command that lets an actor buy past a risk gate) gets rejected regardless of how useful the feature is. If you're not sure a change respects them, say so in the PR description and it'll get worked through in review.

## PR expectations

- Behavior changes need a test. If you fixed a bug, add the test that would have caught it.
- `npm test` must be green before you open the PR — CI runs it on Linux and macOS, Node 22 and 24.
- Keep PRs small and focused on one thing. A PR that mixes a refactor with a behavior change is harder to review and more likely to get punted.
- Match the existing style: no linter/formatter is enforced yet, so read the file you're editing and follow its conventions.
- If your change touches an invariant, a command's JSON shape, or an error code, update the relevant doc (`docs/commands.md`, `docs/errors.md`, `docs/concepts.md`) in the same PR.

## Filing bugs

Open a [GitHub issue](https://github.com/henriquemeireles7/cronfounder/issues) with the bug template: exact command, `--json` output or error block (with its `E_` code if any), and `cronfounder doctor` output. See [docs/errors.md](docs/errors.md) for the error registry before filing — your issue might already have a documented fix.

Security issues: see [SECURITY.md](SECURITY.md), don't file a public issue.
