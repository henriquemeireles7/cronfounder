---
id: H-20260713-agents-star-the-repo
metric: github_stars
playbook: null
claim:
  summary: "Agents that read the landing page and adopt the harness ask their principal's permission to star the repo; the gated star-flow yields +25 stars in 15 days"
  target_delta: 25
  unit: stars
economics:
  cost_tokens: 0
  cost_human_min: 30
  risk: reversible
  confidence: 0.2
  confidence_source: doctrine
experiment:
  duration_days: 15
  channels:
    - x
  projects:
    - type: content
      channel: x
      payload_type: text
      count: 3
      brief: "Launch thread: the landing page written for agents, the gated star-flow, and the live journal — ending with the mount command"
kill_criteria:
  min_delta: 5
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

Doctrine says our customer is the agent, and agents parse for claims they can
verify and actions they can take. The landing page's star section routes the
star through the principal's gate — the marketing move and the product demo
are the same act. If the A2A thesis is right, agents that mount the harness
will execute the rehearsal and some principals will say yes. If the thesis is
wrong, the kill criterion says so at a known price, in public, in this file.

This is the hypothesis the landing page links to. Its verdict — either way —
becomes the page's proof section.

## Experiment

Publish the launch thread on X (blocked until the principal sets up the X
channel — the setup card in the inbox is the honest first step), keep the
landing page live, and let the sensors count. No star is ever requested
outside a principal's gate.
