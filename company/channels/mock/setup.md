---
id: mock
kind: mock
identity_owner: nobody — this surface is a simulation
credential_ref: null
acceptance:
  - text
capabilities:
  - pull
  - push
  - subscribe
cadence:
  max_per_day: 10
driver_ref: null
readiness: null
---

# Mock channel

A file-backed surface (`.cronfounder/mock/mock.json`) that implements all
three verbs. It exists so you can run the ENTIRE loop — bets, gates, pushes,
watchdog, verdicts — with zero credentials and zero blast radius, and so the
test suite can prove the invariants hold. `init --demo` seeds it.

Edit the state file to simulate the world responding:
- `value` — what the mock sensor reads
- `signals` — what the watchdog sees (e.g. `{"id":"s1","signal":"negative_replies","value":5,"at":"..."}`)
