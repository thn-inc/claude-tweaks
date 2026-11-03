# Open Items — Leave a verification stamp on /test's bookkeeping-only skip so review Step 1.5 passes after the ledger commit

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 21 commits ahead of the branch at run start (flow Step 2.5) | fixed | Caught up by merge commit 81d6a5fa1 (Common Step 1 post-creation catch-up) |
| 2 | ops | Pre-flight branch-divergence-check (second resume, run 2026-11-03T180924): origin/main was 9 commits ahead of the branch at run start (flow Step 2.5) | fixed | Caught up by merge commit 4fc28c928 (Common Step 1 post-creation catch-up) |
| 3 | build | plugin/skills/test/verification.md:187 says Step 1.5 treats every verifiedHead:false as "re-run, fail-open", which the new zero-test row partly contradicts; Plan-review answer 2 forbids editing verification.md in this build | deferred | Defer-reason: needs-human-decision — final whole-branch review triaged it as not a merge blocker and the reason as valid; must be filed via /claude-tweaks:capture (one-clause carve-out naming review's zero-test row), not left only here |
| 4 | build | SDD ruling — residual fix-wave Minor got one targeted fix plus one scoped re-review: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 5 | build/skill | skill-prose-conformance-tests extends: a clause pinned "inside a paragraph" needs the check run on the paragraph slice (not file-wide `includes`) and one move-out go-red case per clause, since a combined move-out case only ever fires the first check (#4395 Task 2 rounds 2-3, fix-wave targeted fix) | observation | For wrap-up's Skills curation row |
