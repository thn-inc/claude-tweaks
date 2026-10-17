## Staged: Absorb (github-issues) — #3402 → #3389

**Finding:** [sizing] #3402 "console-resolve.js labels engine-row findings as `{row}:undefined`" duplicates #3389 "Review Console renders every curation-engine finding as {row}:undefined": same root cause (`plugin/bin/lib/console/resolve.js` `engineItems` reads `f.target`, the engine stores `targetPath`), same fix, same test shape. #3389 is older and also covers the two-findings-one-row id collision.
**Proposed:** Absorb #3402 into #3389 (duplicate scope; close not planned)
**Integrate into #3389 (first-class, not an appendix):**
- Deliverables: keep the `f.target` fallback for older `engine-state.json` files (from #3402 item 1); the new console-resolve test must be proven red against the current code (#3402 item 2).
- Acceptance Criteria: add `console-resolve.js --run <dir> --policy console-auto` renders `skills:{targetPath}` for an applied Skills finding, never `skills:undefined` (#3402 AC 1).
**Commands:**
gh issue edit 3389 --body-file <composed body with the integrated scope above>
gh issue comment 3402 --body "Absorbed into #3389 by /claude-tweaks:tidy (sweep 2026-10-17): same resolve.js target/targetPath defect; its fallback and proven-red test requirements are now in #3389's Deliverables/AC."
gh issue close 3402 --reason "not planned"
