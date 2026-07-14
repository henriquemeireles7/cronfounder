# Installation

## Prerequisites

- **Node >= 22.13.** The ledger is `node:sqlite` (`DatabaseSync`), which is flag-free from 22.13. There are zero native dependencies — no node-gyp, no prebuilds, nothing to compile. The CLI checks the floor at entry and exits 1 with `E_NODE_VERSION` if you are below it.
- **git.** Used by the clone install path; `init` also runs `git init` in your new company directory so files-are-canon (invariant V) has teeth.
- **crontab** (optional). Only needed for `cronfounder cron install`. Without it the loop runs whenever you run it.
- **Claude Code** (optional). Only the real runtime needs it. The demo, the stub runtime, and the dry-run/import loop need no model at all.

## Install paths

### Path A — clone, build, link (recommended; durable)

```sh
git clone https://github.com/henriquemeireles7/cronfounder && cd cronfounder && npm install && npm run build && npm link
```

This puts a `cronfounder` binary on your PATH at a stable location. This is the path to use if you intend to install the clocks (`cron install`).

If `npm link` fails with a permissions error, either configure a user-writable npm prefix (`npm config set prefix ~/.npm-global` and add `~/.npm-global/bin` to PATH) or install globally from the checkout: `npm install -g .`

### Path B — npx straight from git

```sh
npx github:henriquemeireles7/cronfounder init my-co --demo
```

npx clones, runs the `prepare` script (which builds `dist/`), and executes the CLI. Good for evaluation; not good for cron, because the npx cache is pruned without warning.

`npx cronfounder` becomes the canonical one-liner once the package is published to npm. Publishing is deliberately a human act (invariant IV: humans own accounts) and is the one open launch TODO.

<a id="durable-install"></a>
## Durable install (required before cron)

`cronfounder cron print` generates crontab lines with **absolute paths** to the current `node` binary and the installed `cli.js`. If that `cli.js` resolves into an npx or temp cache (`/_npx/`, `.npm/_cacache/`, `/tmp/`), `cron install` refuses with `E_EPHEMERAL_BIN` — an npx cache gets pruned, and the clocks would die silently weeks later. Install via Path A (or `npm install -g <path-or-package>`), then re-run `cronfounder cron install`.

`cron status` and `cron print` both report whether the current binary path is durable.

<a id="runtime"></a>
## Runtime setup

The runtime is what wears the thinking hats (strategist, builder, planner narration, onboarding). It is selected in the human-owned `.cronfounder/config.json`:

```json
"runtime": { "adapter": "claude", "timeout_s": 600, "max_turns": 30 }
```

Valid adapters: `claude`, `stub`, `none`. One-off overrides: `--runtime <adapter>` on any command, or the `CRONFOUNDER_RUNTIME` env var. `init` picks the adapter automatically: `stub` for `--demo`, `claude` if the Claude Code CLI is on PATH, otherwise `none`.

### `claude` — the real runtime

1. Install Claude Code: https://claude.com/claude-code
2. Authenticate: run `claude` once interactively and log in. Under cron there is no TTY, so auth must come from the environment — the adapter passes through only `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` (plus PATH/HOME/SHELL/TERM/USER/LANG/LC_ALL). Channel credentials are **never** in a hat's environment.
3. Verify both binary and auth: `cronfounder doctor` runs `claude --version` and then a cheap one-turn test invocation. An unauthenticated CLI is the most common silent killer — it would hang waiting for login, so cronfounder spawns it with stdin closed and a hard timeout, turning a hang into `E_RUNTIME_FAILED` with a fix.

If `claude` lives at a non-standard path, set `runtime.command` in the config.

### `stub` — shipped, deterministic, offline

Writes plausible, schema-valid artifacts with no network, no keys, no model. Powers `init --demo`, tests, and offline development. Its output says so honestly in the artifact bodies.

### `none` + dry-run — you (or your agent) are the runtime

With `adapter: "none"`, commands that need thinking (`strategize`, `build`) fail with `E_RUNTIME_NONE` — unless you pass `--dry-run`. Dry-run writes the exact prompt and expected outputs into a run bundle; you do the thinking, write artifacts into the staging directory, and `cronfounder run import <run-id>` validates and imports them through the identical pipeline a live run uses. No nested runtime spawn, no API key. This is the flagship interface for an operating agent — see [operating.md](operating.md).

## Credentials

Conventions, enforced by design:

- **Files hold references, never secrets.** A metric or channel names `credential_ref: "STRIPE_API_KEY"` — the NAME of an environment variable. The value lives only in your environment.
- **Interactive shells:** `export STRIPE_API_KEY=...` in your shell profile.
- **Cron:** cron loads no shell profile. The generated cron lines source `<company>/.cronfounder/env` before every invocation. Put the exports there and lock it down:

```sh
cat > .cronfounder/env <<'EOF'
export GITHUB_TOKEN=ghp_...
export STRIPE_API_KEY=rk_live_...
EOF
chmod 600 .cronfounder/env
```

- `GITHUB_TOKEN` is optional for the `github_stars` sensor (public API; unauthenticated requests share 60/hour per IP, a token raises it to 5000/hour).
- Verify everything resolves with `cronfounder doctor` — it checks every `credential_ref` in your metrics and channels against the current environment.

## Troubleshooting install failures

| symptom | cause | fix |
|---|---|---|
| `E_NODE_VERSION` on any command | Node < 22.13 | install a current Node LTS — https://nodejs.org |
| `npx github:...` fails during build | `prepare` needs devDependencies; ancient npm | upgrade npm (`npm i -g npm`), or use Path A |
| `cronfounder: command not found` after `npm link` | npm prefix bin dir not on PATH | `npm bin -g` to find it; add to PATH, or use `npm install -g .` |
| `cron install` exits 2 with `E_EPHEMERAL_BIN` | binary resolves into an npx/temp cache | do a [durable install](#durable-install), then retry |
| `E_RUNTIME_NOT_FOUND` from strategize/build | `claude` not on PATH (or `runtime.command` wrong) | install Claude Code, or set `runtime.adapter` to `stub`/`none`, or use `--dry-run` |
| `E_RUNTIME_FAILED` with "no output" | Claude Code installed but not authenticated | run `claude` once interactively; verify with `cronfounder doctor` |
| `E_CRONTAB` on `cron install` | crontab rejected the lines (no cron daemon, restricted user) | `cronfounder cron print` and install by hand with `crontab -e` |
| sensors fail only under cron | env var missing — cron loads no shell profile | put exports in `.cronfounder/env` (chmod 600); verify with `cronfounder doctor` |

Every failure carries a stable `E_*` code with problem/cause/fix — the full registry is [errors.md](errors.md).
