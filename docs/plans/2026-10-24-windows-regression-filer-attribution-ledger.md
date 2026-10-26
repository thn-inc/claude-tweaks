# Open Items — Windows regression filer quotes a pre-existing failure and counts renamed tests as new (#3723)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow | Pre-flight Step 2.5 branch-divergence-check: origin/main was 1 commit ahead of the adopted worktree (8d86e2e6c) at run start | fixed | Absorbed by Common Step 1's post-creation catch-up merge (fast-forward 8323a0e86 -> 8d86e2e6c) |
| 2 | build | SDD Task 1 minor: verification.md trim dropped "the runner's own" before "refusals, the ref and its tip" | fixed | Restored in final-review fix wave 2e5a9d5a6 (verification.md 52498 B) |
| 3 | build | SDD Task 1 minor: baseline.test.js no-entry case (b) did not isolate the isoTree.wellFormed guard | fixed | Well-formed base log in 2e5a9d5a6; go-red proven in scratch worktree |
| 4 | build | SDD Task 1 minor: verification.md attributedTests clause omits "entry only when per-test identity is known" and "absentAtBase may be null" | accepted | Does not fit the 52500-B Read-limit rail without cutting contract facts; docs/plugin-structure.md's baseline.js entry and baseline.js's own comment state both, and the only consumer (file-issue.js) handles both — final review triaged it fix-if-bytes-fit |
| 5 | build | SDD Task 2 minor: file-issue.js pointer comment named TAP_NAME_RE instead of testTree's TAP_POINT_RE/TAP_OPEN_RE | fixed | 2e5a9d5a6 |
| 6 | build | SDD Task 2 minor: file-issue.js SKIP/TODO directive match wider than TAP_POINT_RE's | fixed | 2e5a9d5a6 (/ # (?:SKIP\|TODO)\b/i) |
| 7 | build | SDD Task 2 minor: file-issue.js `\r` strip in excerptsForTests is dead (sources split on \r?\n); CRLF test does not exercise it | accepted | Harmless defensive code; final review triaged can-defer |
| 8 | build | SDD Task 2 minor: no per-file excerpt cap | fixed | EXCERPTS_PER_FILE = 5 plus "more not quoted" line in 2e5a9d5a6 |
| 9 | build | SDD Task 2 minor: "attribution unavailable" label also covered "entry present, no block found" | fixed | Two labels in 2e5a9d5a6 |
| 10 | build | SDD Task 2 minor: cross-source slot merge can double-quote a repeated path split between the log and the failing region | accepted | Unreachable in practice — the failing region is cut from the same uncapped log, so the log already holds anything the region does (final review triage) |
| 11 | build | SDD ruling — Task 2's baseline.js revert-check uses dab298fe7 (pre-Task-1), not HEAD~1: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 12 | build | SDD ruling — plan Task 3 (full suite) folded into /build Common Step 5, not dispatched: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 13 | build | SDD ruling — filer duplicates the small TAP not-ok name/directive regex locally instead of exporting from extract.js: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 14 | build | SDD ruling — residual final-review Minor (plugin-structure.md lacks ownOnly) routed to /build Common Step 6.5 docs sync, no second fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 15 | wrap-up | pr — PR #4034 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
| 16 | wrap-up | residue sweep suite probe not run (skipped via --no-suite) — the run's suite state is the verification pass stamp, not this probe | observation | — |
