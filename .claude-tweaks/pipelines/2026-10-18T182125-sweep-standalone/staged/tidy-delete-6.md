# Staged: Delete (GitHub) — #159

**Finding:** [parked] "Decide whether work-backend / work-types / record-staleness-weeks move to policy.yml" — 70d stale — trigger (a fourth config key or a live misread) not observed.

**Proposed:** Close as not planned — parked 70d, stale, trigger not met

**Why:** Shape 2 — neither trigger met and the record is Stale; recommendation Re-evaluate or delete. Closing a GitHub issue is outward-facing, so it stages at every tier.

**Commands:**

```bash
gh issue comment 159 --body "Closed by /claude-tweaks:tidy: parked 70d with its trigger unmet; reopen if it fires." && gh issue close 159 --reason "not planned"
```

Re-verify before applying: the record is still open, still `parked`, and its trigger still unmet.
