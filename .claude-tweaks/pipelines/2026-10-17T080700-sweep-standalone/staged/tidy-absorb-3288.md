## Staged: Absorb (github-issues) — #3288 → #3261

**Finding:** [sizing] #3288 is a strict subset of #3261: #3261's single deliverable already adds tests/bin-lib/gif/palette.test.js and tests/statusline.test.js to .claude-tweaks/verify-scope.json's flaky.files — #3288 covers only tests/statusline.test.js. Nothing to integrate into #3261 (its Deliverables/AC already cover this file).
**Proposed:** Absorb into #3261 (duplicate scope; close not planned)
**Commands:**
gh issue comment 3288 --body "Absorbed into #3261."
gh issue close 3288 --reason "not planned"
