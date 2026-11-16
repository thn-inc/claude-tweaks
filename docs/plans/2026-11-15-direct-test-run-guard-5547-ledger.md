# Open Items — Guard direct multi-file node --test runs and steer them to tools/run-tests.js (#5547)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 3 exports `realDeps()` (the fs-backed deps its CLI entry uses) from tools/direct-test-run-…: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — every task runs the fallback affected set (the focused test files its brief names, one file per…: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — Task 5 gets a task review only if it commits a change; with no commit there is no diff, and its…: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — fix it in Task 1, before review: parseRunnerOperands takes an optional injected `realpath(absPa…: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — the three Minor findings (no non-zero exit pinned for a file-operand run; "does not exist" for …: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | SDD ruling — the misses are closed in Task 2 before review: prefix commands (env, time, nice, nohup, command…: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 7 | build | SDD ruling — the classifier is split into a throwing inner function and the catching `classifyCommand`, and …: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 8 | build | SDD ruling — all five Minor findings are fixed in round 1, not deferred: each passes the deferral gate's fix…: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 9 | build | SDD ruling — Task 3 mirrors the classifier's split (judgeOrThrow plus the catching judge) and reuses the cla…: ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
| 10 | build | SDD ruling — the JavaScript script scan is narrowed from the spec's "the exact string literal --test togethe…: ratify or reverse at the Review Console (staged/sdd-ruling-10.md) | open | — |
| 11 | build | SDD ruling — "executes one by path" follows the spec, not the brief's four extensions: ratify or reverse at the Review Console (staged/sdd-ruling-11.md) | open | — |
| 12 | build | SDD ruling — residual (1) stands as built: counting a literal only when it is an argument of an exec/spawn c…: ratify or reverse at the Review Console (staged/sdd-ruling-12.md) | open | — |
| 13 | build | SDD ruling — residuals (2)-(5) and the three observations each meet the deferral gate's fix-now criteria (lo…: ratify or reverse at the Review Console (staged/sdd-ruling-13.md) | open | — |
| 14 | build | SDD ruling — targeted-fix item R4 is not confirmed and stays unfixed in the build: ratify or reverse at the Review Console (staged/sdd-ruling-14.md) | open | — |
| 15 | build | SDD ruling — the targeted fix introduced a rare false deny that stays unfixed in the build: ratify or reverse at the Review Console (staged/sdd-ruling-15.md) | open | — |
| 16 | build | SDD ruling — a tilde in a `for` word list or an assignment is not expanded and stays unfixed in the build: ratify or reverse at the Review Console (staged/sdd-ruling-16.md) | open | — |
| 17 | build | SDD ruling — the script scan is skipped for a segment that is a direct test run (targeted-fix item R7), so `…: ratify or reverse at the Review Console (staged/sdd-ruling-17.md) | open | — |
| 18 | build | SDD ruling — R3 (brace-body `for f in a b; { node --test x; }` loop allows) stays a known miss: ratify or reverse at the Review Console (staged/sdd-ruling-18.md) | open | — |
| 19 | build | SDD ruling — queued item 6 goes the reviewer's way: after pushd/popd the cwd is unknown and the classifier a…: ratify or reverse at the Review Console (staged/sdd-ruling-19.md) | open | — |
| 20 | build | SDD ruling — operands decide the checkout (brief B4): operands with no runner above them allow; operands in …: ratify or reverse at the Review Console (staged/sdd-ruling-20.md) | open | — |
| 21 | build | SDD ruling — final-review Minor 9 (chained single-file runs in one Bash call are allowed) is not fixed in th…: ratify or reverse at the Review Console (staged/sdd-ruling-21.md) | open | — |
| 22 | build | SDD ruling — final-review "Declined to judge" lines stand as declined (spec design: skip directories; indire…: ratify or reverse at the Review Console (staged/sdd-ruling-22.md) | open | — |
| 23 | build | SDD ruling — the whole-branch review starts while the probe is still reading: ratify or reverse at the Review Console (staged/sdd-ruling-23.md) | open | — |
| 24 | build | SDD ruling — Task 5 runs as a read-only probe in parallel with Task 4's review (agent a6ac0423a67e47463, son…: ratify or reverse at the Review Console (staged/sdd-ruling-24.md) | open | — |
| 25 | build | SDD ruling — the runner route keeps taking the subset slot for file operands, as the spec and AC3/AC14 say: ratify or reverse at the Review Console (staged/sdd-ruling-25.md) | open | — |
