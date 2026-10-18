# Staged: Delete (GitHub) — #126

**Finding:** [parked] "Reconsider a grouping-by-blocker affordance in ledger resolve-gate Phase 2" — 56d stale — trigger (3+ identical-blocker items in a real resolve run) not observed.

**Proposed:** Close as not planned — parked 56d, stale, trigger not met

**Why:** Shape 2 — neither trigger met and the record is Stale; recommendation Re-evaluate or delete. Closing a GitHub issue is outward-facing, so it stages at every tier.

**Commands:**

```bash
gh issue comment 126 --body "Closed by /claude-tweaks:tidy: parked 56d with its trigger unmet; reopen if it fires." && gh issue close 126 --reason "not planned"
```

Re-verify before applying: the record is still open, still `parked`, and its trigger still unmet.
