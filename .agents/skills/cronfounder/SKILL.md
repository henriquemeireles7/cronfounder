---
name: cronfounder
description: Operate a company inside the cronfounder harness — sense, plan, strategize, resolve, build, push, watch, verdict. Use when the principal asks to run, check, or grow their cronfounder company; when they mention inbox cards, bets, gates, gaps, verdicts, or a company.db; or when a directory contains .cronfounder/. Do not use for editing cronfounder's own source, for generic business advice outside a company dir, or as a way to bypass the human gate on approvals.
license: MIT
compatibility: Requires the cronfounder CLI on PATH (Node >= 22.13) and git.
metadata:
  author: henriquemeireles7
  version: "0.1.0"
  openclaw:
    requires:
      bins: [cronfounder, git]
    install:
      - kind: node
        package: cronfounder
        bins: [cronfounder]
    emoji: "🏭"
    homepage: https://github.com/henriquemeireles7/cronfounder
---

# Operate a cronfounder company

You are the operating agent; the human is the principal. The deterministic core
enforces ten invariants mechanically — do not fight them, relay them.

## Quick contract
- Always pass `--json`. Parse the one envelope on stdout; all progress is on stderr.
- Exit codes are the contract: `0` ok · `1` error · `2` your usage is wrong ·
  `3` a gate refused · `4` busy/locked (another process holds the lock — wait, retry
  the same command).
- Exit `3` means an invariant said no, and the error names it. It is the product
  working, not a crash. Do NOT retry it, do NOT find another path to the same side
  effect, and never hand-edit files, events, or the ledger to route around it. Follow
  the error's `fix` if it is operational; otherwise relay the refusal to the principal
  verbatim.

## If no company exists yet
1. `cronfounder doctor --json` — check Node >= 22.13, runtime auth, clocks.
   Install: `git clone https://github.com/henriquemeireles7/cronfounder && cd cronfounder && npm install && npm run build && npm link`
2. `cronfounder init <dir> --yes --url <site> --repo <owner/name>` (or `--demo` to
   evaluate with zero credentials, zero network). Then read `AGENTS.md` in the company dir.

## Per tick (the loop)
sense → plan → strategize → resolve (fund) → build → resolve (release) → push →
watch → verdict → better bets. Forever.

1. `cronfounder sense --json && cronfounder plan --json` — act on each
   `data.gap.rows[].classification`: `naked` → `cronfounder strategize <metric>` ·
   `verdict_due` → `cronfounder verdict` · `needs_decision`/`blocked` → relay the open
   card · `running`/`green` → nothing.
2. `cronfounder watch --json` every ~10 min while watch windows are open;
   `data.tripped` non-empty means a tripwire fired — relay the urgent card immediately.
3. `cronfounder verdict --json` on the season tick — relay `decided`, `inconclusive`,
   and `restrategized` outcomes.
4. If cron is installed (`cronfounder cron status`), the clocks already run
   sense/plan/watch/verdict — read the results instead. If not, you ARE the clocks.

## The inbox relay rule (non-negotiable)
After any tick: `cronfounder inbox --json`. For every open card, relay it to the
principal — the `what`, the `why` (traced to hypothesis → metric), the `choices` with
their prices, and your recommendation — then run its `resolve_hint` exactly as they
answer. You may `cronfounder resolve` on your own authority ONLY with standing
authorization written and scoped in `doctrine/constitution.md`, and you must always
attribute yourself: `--as agent:<your-name>`. An approval without honest attribution is
a forged signature.

See [reference.md](reference.md) for the gap model, card kinds and resolve forms, the
dry-run/import lane, doctor checks, and the cron clocks.
