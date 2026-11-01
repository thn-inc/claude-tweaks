# Open Items — build: dispatch rules forbid git stash but not image-name process kills (#4548)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 14 commits ahead of the worktree branch at run start | fixed | Post-creation catch-up merged origin/main (merge commit 1e1f4166c) |
| 2 | ops | Shape check: prior-run plan Task 1 and Task 3 each touch 6 files (>5-file hard-fail signal); auto proceeded | fixed | Revised plan splits the work into 5 tasks of at most 5 files each (plan commit refs #4548, docs/superpowers/plans/2026-10-31-process-kill-guard.md) |
| 3 | build | git-command.js grows by ~147 lines on a ~3,550-line file; the parser needs the module's private helpers, so a split is circular today | deferred | Defer-reason: genuinely-larger — final whole-branch review triaged it fine as deferred |
| 4 | build | `coproc pkill node` and `time ! pkill node` return [] (coproc is not a compound lead; `!` after a wrapper) | deferred | Defer-reason: tangential — final review: fine as deferred |
| 5 | build | Joined-text pgrep arming adds the cross-word false positive `echo '$(' pgrep node; kill 1` (warn-only) | deferred | Defer-reason: tangential — final review: fine as deferred |
| 6 | build | ps PID-lookup exemption ignores an all-processes selector beside `-p` (`ps -e -p 1 \| grep node \| xargs kill` is silent) — Ruling: real but deferred; the residual override's one targeted fix is spent | observation | Defer-reason: tangential — parked after the residual fix's scoped re-review (f339b6eb7) |
| 7 | build | Follow-up record: gitTargets/mkdirTargets miss compound-word-led segments (`if true; then git commit -m x; fi` → []), a bypass of the worktree-always/E1 deny gates — pre-existing outside this diff; the final review asks for a spec-shaped record via /claude-tweaks:capture | open | Defer-reason: pre-existing-outside-diff — file the record at wrap-up |
| 8 | build | SDD ruling — go-red proofs run in a scratch checkout, not in place: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 9 | build | SDD ruling — implementers commit before running go-red proofs: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 10 | build | SDD ruling — build/dispatch.md name-kill sentence sits after the stash-guard paragraph: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 11 | build | SDD ruling — Continuation-call pointer names no trigger (non-finding): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 12 | build | SDD ruling — lsof absence guard matches only the AC grep literal (non-finding): ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 13 | build | SDD ruling — pgrep arming stays command-wide: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 14 | build | SDD ruling — word-bounded kill pre-check is a non-finding: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 15 | build | SDD ruling — final fix wave composition (positional PowerShell recorded, not matched): ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 16 | build | SDD ruling — order-aware ps\|grep arming with ps -p exempt (residual override): ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
