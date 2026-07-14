---
id: H-20260714-build-in-public-loop
metric: github_stars
playbook: build-in-public
claim:
  summary: "Posting the company's own loop output (gap reports, funded bets, verdicts) on X 3x/week moves +40 stars in 15 days"
  target_delta: 40
  unit: stars
economics:
  cost_tokens: 90000
  cost_human_min: 45
  risk: reversible
  confidence: 0.25
  confidence_source: doctrine
experiment:
  duration_days: 15
  channels:
    - x
  projects:
    - type: content
      channel: x
      payload_type: text
      count: 6
      brief: "Build-in-public series: each post is a real artifact from this company's journal — a gap report, a funded bet with its price, a verdict with its delta"
kill_criteria:
  min_delta: 10
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

Doctrine: the ICP follows builders whose problems they share, and our voice is
"claims an agent can verify." A build-in-public series where every post links
the journal entry it describes is unfakeable content — the product generates
its own marketing artifacts. The playbook exists so the track record accrues
somewhere and autonomy can be earned on evidence.

## Experiment

Six posts over two weeks, drafted by the content builder from the real
journal, every one through the gate. Verdict from the stars sensor alone.
