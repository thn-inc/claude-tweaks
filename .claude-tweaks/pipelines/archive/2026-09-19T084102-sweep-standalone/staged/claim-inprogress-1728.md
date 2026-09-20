# Staged: Remove orphaned bot:in-progress label — #1728

**Finding:** Issue #1728 carries `bot:in-progress` with no active claim in the claims registry — a label-only outward-facing GitHub write, staged for approval per the auto-mode contract's reversibility floor (never auto-applied at any tidy tier).

**Proposed:** Remove the orphaned `bot:in-progress` label.

**Commands:**
```
gh issue edit 1728 --remove-label bot:in-progress
```
