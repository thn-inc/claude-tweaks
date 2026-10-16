# Open Items — build / deferral-gate: pre-existing defect in an in-diff file (#3117)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence: origin/main was 7 commits ahead of local main at run start | fixed | Post-creation catch-up fast-forwarded the worktree to origin/main (e41d928) and a later merge picked up 3d4b84b; no divergence remains on the branch |
| 2 | build | Implementer reported plugin/skills/dispatch/SKILL.md at 46,138 B, over the 46,080 B ceiling (5 unrelated test failures) — pre-existing, outside this diff | accepted | Already fixed on origin/main by #3231 (dispatch/SKILL.md now 46,022 B); merged into this branch before verification, full suite green |
| 3 | wrap-up | plugin/skills/build/SKILL.md is 45,468 B after this change — 612 B under the 45 KB per-file soft ceiling (warning-tier since #1990) | observation | The next addition to build/SKILL.md will cross the warning tier; plan a split before appending there |
