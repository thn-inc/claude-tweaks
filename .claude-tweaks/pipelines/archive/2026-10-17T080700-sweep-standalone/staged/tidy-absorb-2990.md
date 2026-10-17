## Staged: Absorb (github-issues) — #2990 → #3175

**Finding:** [sizing] #2990 "CHANGELOG.md is missing the v6.136.0 entry" sits inside #3175's range ("Backfill missing CHANGELOG.md entries for v6.136.0–v6.140.1"). Before closing, confirm #3175's Deliverables name v6.136.0 explicitly; if not, integrate it as a Deliverables bullet first.
**Proposed:** Absorb into #3175 (v6.136.0 is inside its backfill range)
**Commands:**
gh issue comment 2990 --body "Absorbed into #3175."
gh issue close 2990 --reason "not planned"
