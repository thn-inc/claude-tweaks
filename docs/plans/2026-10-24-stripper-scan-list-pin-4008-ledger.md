# Open Items — Pin the stripper-scan list in the helper header and parse-signal-discipline item 15 to the tree (#4008)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead (d36f5f6a5) at flow Step 2.5 | fixed | Post-creation catch-up fast-forwarded the worktree branch c300bb076 -> d36f5f6a5 before any build commit |
| 2 | build | Comment filter in tests/strip-comments-callers-twin.test.js drops only lines starting with // or *; a require in a trailing // or one-line /* */ comment would count as a caller (fails loud, not silent) | deferred | SDD task-review minor (deferred), carried forward at SDD Finish — not staged; triage at wrap-up |
| 3 | build | liveTestFiles() in tests/strip-comments-callers-twin.test.js re-walks tests/ in ~8 call sites per run; could compute once (negligible cost) | deferred | SDD task-review minor (deferred), carried forward at SDD Finish — not staged; triage at wrap-up |
| 4 | build | .claude/skills/bin-source-scan-conformance/SKILL.md:40 holds a third hand-written scan list ("Seven scans do this") — a different claim (which scans report a stripper verdict as an offender), outside #4008's two-list scope, unpinned | deferred | SDD task-review minor (deferred), carried forward at SDD Finish — not staged; triage at wrap-up |
| 5 | build | Go-red control (d) in tests/strip-comments-callers-twin.test.js exercises only the // branch of the comment filter, not the * branch | deferred | SDD task-review minor (deferred), carried forward at SDD Finish — not staged; triage at wrap-up |
