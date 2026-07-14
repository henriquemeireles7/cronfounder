---
id: x
kind: x
identity_owner: "(fill: the human who owns this account — agents operate, never own)"
credential_ref: X_MCP_CREDENTIAL
acceptance:
  - text
capabilities:
  - push
  - pull
cadence:
  max_per_day: 3
driver_ref: x
readiness: null
---

# X (Twitter) channel

This file is DESCRIPTIVE. The executable driver mapping (which MCP server to
spawn, which tool maps to push/pull) lives in the human-owned
`.cronfounder/config.json` under `drivers.x` — a model can draft this file,
but it can never add an executable. See docs/commands.md#drivers for the
config shape and an example X MCP server wiring.

Conformance: this channel implements `push` (and `pull` for watchdog
signals). `subscribe` is declared in the ontology but not implemented for X
in the MVP — calling it returns E_UNSUPPORTED_CAPABILITY.

Note on reality: X API write access is paid and rate-limited. The mock
channel exists so you can run the whole loop without it; wire X when the
economics make sense for you.
