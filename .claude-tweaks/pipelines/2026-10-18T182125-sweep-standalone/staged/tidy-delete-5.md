# Staged: Delete (GitHub) — #279

**Finding:** [parked] "Event-driven dispatch via GitHub webhook trigger" — 56d stale — #155 closed, but the rate/circuit-breaker half of the trigger is unverified.

**Proposed:** Close as not planned — parked 56d, stale, trigger not met

**Why:** Shape 2 — neither trigger met and the record is Stale; recommendation Re-evaluate or delete. Closing a GitHub issue is outward-facing, so it stages at every tier.

**Commands:**

```bash
gh issue comment 279 --body "Closed by /claude-tweaks:tidy: parked 56d with its trigger unmet; reopen if it fires." && gh issue close 279 --reason "not planned"
```

Re-verify before applying: the record is still open, still `parked`, and its trigger still unmet.
