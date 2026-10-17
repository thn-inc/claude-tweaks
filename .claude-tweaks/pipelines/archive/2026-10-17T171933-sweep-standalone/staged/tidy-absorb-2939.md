## Staged: Absorb (github-issues) — #2939 → #3175

**Finding:** [sizing] #2939 "CHANGELOG missing entry for v6.134.1" is the same CHANGELOG tag-backfill operation #3175 performs for v6.136.0–v6.140.1 (and the earlier-staged #2990 absorb adds v6.136.0 there too); its second deliverable (residue scan reports zero `release` findings) is #3175's own acceptance check.
**Proposed:** Absorb #2939 into #3175 (same CHANGELOG backfill; close not planned)
**Integrate into #3175 (first-class, not an appendix):**
- Current State / Deliverables: add v6.134.1 to the list of tags missing a CHANGELOG heading, backfilled in tag order with the others.
- Acceptance Criteria: CHANGELOG.md at HEAD has a heading for 6.134.1 as well; the repo-wide residue scan reports zero tag/CHANGELOG `release` findings.
- Note: #2939 carries auto:build + auto:merge; #3175 does not — granting #3175 stays `/claude-tweaks:backlog refine`'s call.
**Commands:**
gh issue edit 3175 --body-file <composed body with v6.134.1 integrated>
gh issue comment 2939 --body "Absorbed into #3175 by /claude-tweaks:tidy (sweep 2026-10-17): same CHANGELOG tag-backfill; v6.134.1 is now in #3175's Deliverables/AC."
gh issue close 2939 --reason "not planned"
