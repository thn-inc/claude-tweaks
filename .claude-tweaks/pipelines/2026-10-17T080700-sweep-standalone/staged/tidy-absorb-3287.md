## Staged: Absorb (github-issues) — #3287 → #3261

**Finding:** [sizing] #3287 is a strict subset of #3261: #3261's single deliverable already adds tests/bin-lib/gif/palette.test.js and tests/statusline.test.js to .claude-tweaks/verify-scope.json's flaky.files — #3287 covers only tests/bin-lib/gif/palette.test.js. Nothing to integrate into #3261 (its Deliverables/AC already cover this file).
**Proposed:** Absorb into #3261 (duplicate scope; close not planned)
**Commands:**
gh issue comment 3287 --body "Absorbed into #3261."
gh issue close 3287 --reason "not planned"
