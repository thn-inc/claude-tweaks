# Staged: Delete (GitHub) — #2448

**Finding:** [parked] "Dispatch/tidy: a swept stale claim with a still-open PR goes undetected until something else surfaces it" — 34d stale — prose trigger (next tidy/dispatch change to the stale-claim sweep) not observed.

**Proposed:** Close as not planned — parked 34d, stale, trigger not met

**Why:** Shape 2 — neither trigger met and the record is Stale; recommendation Re-evaluate or delete. Closing a GitHub issue is outward-facing, so it stages at every tier.

**Commands:**

```bash
gh issue comment 2448 --body "Closed by /claude-tweaks:tidy: parked 34d with its trigger unmet; reopen if it fires." && gh issue close 2448 --reason "not planned"
```

Re-verify before applying: the record is still open, still `parked`, and its trigger still unmet.
