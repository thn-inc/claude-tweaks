# Staged: Remove orphaned bot:in-progress label — #2472

**Finding:** Issue #2472 carries `bot:in-progress` with no active claim in the claims registry — a label-only outward-facing GitHub write, staged for approval per the auto-mode contract's reversibility floor (never auto-applied at any tidy tier).

**Proposed:** Remove the orphaned `bot:in-progress` label.

**Commands:**
```
gh issue edit 2472 --remove-label bot:in-progress
```
