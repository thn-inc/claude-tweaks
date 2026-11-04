# Open Items — Host-qualify the origin-derived repo slug (#4794)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 40 commits ahead of the resumed branch at run start | fixed | Caught up by Post-creation catch-up merge a499ee880 |
| 2 | ops | Pre-flight branch-divergence-check (run 2026-11-03T083002): origin/main was 23 commits ahead at run start | fixed | Caught up by Post-creation catch-up merge of origin/main 3ebed678f |
| 3 | ops | Shape check hard-fail signal: plan Task 4 declares 8 files (4 modified + 4 tests), over the 5-file ceiling; auto proceeded | fixed | Plan revised (commit 4140a9086); no task now declares more than 5 files — run 2026-11-04T045629's shape check passed |
| 4 | ops | Pre-flight branch-divergence-check (run 2026-11-03T163447): origin/main was 19 commits ahead at run start | fixed | Caught up by Post-creation catch-up merge 094dd57b1 |
| 5 | ops | Pre-flight branch-divergence-check (run 2026-11-04T045629): origin/main was 25 commits ahead at run start | fixed | Caught up by Post-creation catch-up merge deca56e82 |
| 6 | ops | Pre-flight branch-divergence-check (run 2026-11-04T061219): origin/main was 5 commits ahead at run start | fixed | Caught up by Post-creation catch-up merge ccd22e5c7 |
