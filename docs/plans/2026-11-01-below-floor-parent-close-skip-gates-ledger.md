# Open Items — 4799: Run below-floor-parent-close parent-level skip gates before the per-sibling reads

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow/ops | Pre-flight branch divergence (test resume call): origin/main is 1 commit ahead (1e8778b46, hung-forge degrade memo) — touches none of this branch's 8 files; review's pre-review catch-up merges it | fixed | Caught up at test exit in merge d728d4026 (origin/main had by then also gained #4770's 51355951f, which conflicted on below-floor-parent-close.js's require list, the plugin-structure parent-gate.js export list and the journey's Updated-by lines — all resolved as unions); re-verified in the test phase |
