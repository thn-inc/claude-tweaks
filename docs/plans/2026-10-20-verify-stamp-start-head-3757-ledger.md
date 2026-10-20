# Open Items — verify.js stamps the HEAD it reads after the checks finish, so a mid-run commit gets a pass it never had

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 24 commits ahead of local main at run start | observation | Post-creation catch-up merged origin/main into the worktree branch (d170e1b4e → 75caf65ce) |
| 2 | ops | #3757 overlaps open #2987 and #3002 on `plugin/bin/verify.js` (both attached to stale PR #3332) | observation | Warning only (flow Step 2.8); built #3757 alone — whoever rescues #3332 rebases over this change |
| 3 | build | SDD ruling — moved = start sha !== end sha only (dirty excluded from moved; stamp dirty is start OR end, null when either read failed — amended 83ff5ef4b, a05770fda): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | |
| 4 | build | Task review Minors (3) + re-review Minors (2): moved line wording under --no-stamp/failing run; transient end-of-run gitInfo() failure withholds the stamp; failing-path no-stamp asserts redundant; stdout sha regex loose | accepted | Accurate/fail-safe behavior, no defect; the one real gap (failing-path line unpinned) was fixed in 7b0d72a29 |
| 5 | wrap-up | pr — PR #3775 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | |
| 6 | wrap-up | suite — the fact pack's residue probe skipped the suite (--no-suite); suite state comes from verify.js's pass stamp and report.json, re-run after a05770fda | observation | |
