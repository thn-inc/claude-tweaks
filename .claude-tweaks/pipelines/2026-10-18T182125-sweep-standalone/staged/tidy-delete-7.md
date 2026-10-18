# Staged: Delete (GitHub) — #127

**Finding:** [parked] "Scope harness-health's run log + churn-report to a single coherent caller" — 65d stale — trigger (someone wants churn-report diagnostics) not observed.

**Proposed:** Close as not planned — parked 65d, stale, trigger not met

**Why:** Shape 2 — neither trigger met and the record is Stale; recommendation Re-evaluate or delete. Closing a GitHub issue is outward-facing, so it stages at every tier.

**Commands:**

```bash
gh issue comment 127 --body "Closed by /claude-tweaks:tidy: parked 65d with its trigger unmet; reopen if it fires." && gh issue close 127 --reason "not planned"
```

Re-verify before applying: the record is still open, still `parked`, and its trigger still unmet.
