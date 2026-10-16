# Open Items — #3013 PR-check gate for /test and /review Step 1.5

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build/ops | Pre-flight branch-divergence: local main 7 behind origin/main (ff blocked by untracked sibling-run files in the main checkout) | observation | Post-creation catch-up merged origin/main (09e0b08 → 62c548b) before any work; nothing outstanding |
| 2 | build/ops | origin/main tip 62c548b is CI-red (5 byte-ceiling tests on dispatch/SKILL.md) — this PR's CI inherits it until the fix lands | observation | Sibling PR #3231 ("Trim dispatch/SKILL.md under the context-cost ceiling") is the fix; re-check before merge |
