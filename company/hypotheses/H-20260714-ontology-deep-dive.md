---
id: H-20260714-ontology-deep-dive
metric: github_stars
playbook: null
claim:
  summary: "A technical deep-dive thread on the ontology (six nouns, ten invariants, the event-sourced ledger) reaches the systems-minded slice of the ICP for +15 stars in 10 days"
  target_delta: 15
  unit: stars
economics:
  cost_tokens: 40000
  cost_human_min: 15
  risk: reversible
  confidence: 0.2
  confidence_source: guess
experiment:
  duration_days: 10
  channels:
    - x
  projects:
    - type: content
      channel: x
      payload_type: text
      count: 4
      brief: "Deep-dive thread: why growth doesn't compile, spec vs status, the WIP-limit as attribution discipline, and verdicts as the moat"
kill_criteria:
  min_delta: 4
  tripwires:
    - source: x
      signal: negative_replies
      aggregation: count
      comparator: ">="
      threshold: 10
      window_minutes: 120
      min_samples: 0
      missing_policy: ignore
state: blocked
---

## Theory

The spec doc itself is our densest artifact and the part of the audience that
picks tools by their bones responds to bones. Confidence source is honestly a
guess — no journal precedent yet; that is exactly what this bet exists to buy.

## Experiment

Four-post thread mapping the ontology, linking the hosted spec at /ontology/.
Gate on every post; stars sensor decides.
