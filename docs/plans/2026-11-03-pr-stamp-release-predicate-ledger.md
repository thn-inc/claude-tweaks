# Open Items — Extract the PR-stamp release rule so the push gate and phase-exit.js call one predicate

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | flow Step 2.5: origin/main was 21 commits ahead of the adopted branch at pre-flight | fixed | Caught up by merge commit f41d32728 (Common Step 1 post-adopt catch-up) |
| 2 | ops | flow Step 2.6 shape signal: plan Task 1 declares 7 files (> 5; was 6 before round-2 answer 4 added `docs/plugin-structure.md`) | accepted | One cohesive change: the two code files that share the predicate, the three docs that describe it, and its two test files; auto mode proceeded per validation.md 2.6 |
| 3 | build | `plugin/bin/lib/hooks/pre-tool-use.js`'s comment above `perSpecPathspec` and `docs/hooks.md` line 41 (#2571) say the gate receives a `spec-N` run dir, contradicting `docs/hooks.md` line 29 (hooks resolve runs from the Bash call's cwd, never a per-spec dir) | open | Defer-reason: needs-human-decision — record #4344 plan-review answer 5 ruled it a follow-up outside this build; file one backlog record at wrap-up |
