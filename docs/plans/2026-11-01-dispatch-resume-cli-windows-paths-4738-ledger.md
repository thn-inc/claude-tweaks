# Open Items — Windows regression: 1 test file(s) newly failing after 8b610e3ec (#4738)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Pre-flight branch-divergence-check: origin/main was 4 commits ahead of local main at /flow Step 2.5 | observation | Converged before any build work: local main matched origin/main (7706249) at worktree creation, and the post-creation catch-up merges were no-ops. Recorded as an observation, not `ops`: there is no manual step |
| 2 | build | Step 2.8 file-overlap warning: #4738 shares plugin/bin/dispatch-resume.js and/or tests/bin-lib/dispatch/dispatch-resume-cli.test.js with open #4743, #4748, #4750, #4754, #4755, #4809, #4813, #4815, #4849, #4855 | observation | Informational only. The claim proceeded on #4738 alone. Expect merge-order friction with whichever of these lands first |
