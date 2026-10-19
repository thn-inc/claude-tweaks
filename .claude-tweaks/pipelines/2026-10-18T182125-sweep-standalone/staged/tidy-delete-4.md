# Staged: Delete (GitHub) — #794

**Finding:** [parked] "GitHub App installation identity for the fleet" — 62d stale — trigger (a repeat quota exhaustion) not observed.

**Proposed:** Close as not planned — parked 62d, stale, trigger not met

**Why:** Shape 2 — neither trigger met and the record is Stale; recommendation Re-evaluate or delete. Closing a GitHub issue is outward-facing, so it stages at every tier.

**Commands:**

```bash
gh issue close 794 --reason "not planned" --comment "tidy: parked 62d, trigger unmet"
```

Re-verify before applying: the record is still open, still `parked`, and its trigger still unmet.
