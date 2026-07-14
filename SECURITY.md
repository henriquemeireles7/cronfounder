# Security policy

## Supported versions

cronfounder is pre-1.0. Only the latest `0.x` release on npm is supported — there is no back-porting of fixes to older 0.x versions.

## Scope

cronfounder is a CLI that runs entirely on your machine: no server, no hosted component, no telemetry. The attack surface is local — the files it reads and writes, the runtime it shells out to, the sensors it calls, and the credentials it references.

Secrets (API tokens, runtime auth) are never stored by cronfounder itself. They live in your environment or in `.cronfounder/env`, which is git-ignored by the scaffold. A vulnerability report about a secret leaking into a committed file, a journal entry, or a rendered HTML view is in scope; a report about how you chose to manage your own environment variables is not.

## Reporting a vulnerability

Do not open a public GitHub issue for a security problem.

Report privately via [GitHub Security Advisories](https://github.com/henriquemeireles7/cronfounder/security/advisories/new) on `henriquemeireles7/cronfounder`.

Include:
- the affected version
- exact reproduction steps or a PoC
- what you'd expect to happen vs. what happens

## Disclosure

This is a single-maintainer project — response times are best-effort, not SLA'd. The target is an initial response within a few days and a fix or mitigation plan within 90 days of confirmation. Coordinated disclosure after 90 days (or sooner, once a fix ships) is the default; if you need a different timeline, say so in the report.
