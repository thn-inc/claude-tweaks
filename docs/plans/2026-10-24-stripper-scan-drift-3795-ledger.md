# Open Items — Fix the pre-existing stripper-scan drift found during record 3773's review

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Step 2.5 pre-flight branch-divergence-check: origin/main was 1 commit ahead (d47cd98d5) at pre-flight; build's post-creation catch-up fast-forwarded the worktree to origin/main (15bc3a825). | fixed | Already resolved in-run by build's post-creation catch-up — `15bc3a825` (decisions.md, /build 08:14:37) |
| 2 | build | tests/helpers/strip-comments.js header line 5 runs past the file's comment wrap width after the scan-list edit | fixed | Reflowed at wrap-up triage — `959b4df94` (the earlier `deferred` was a hold for triage, not a staged record) |
| 3 | build | parse-signal-discipline SKILL.md item 12's `5c8e2a2e0` (#3023) line is one line longer than its neighbours | fixed | Reflowed at wrap-up triage — `959b4df94` (the earlier `deferred` was a hold for triage, not a staged record) |
| 4 | build | path-containment planted mis-parse fixture carries no blanked startsWith(...) line, so it proves "no throw" rather than a swallowed hit | accepted | `scanBinTree` and `assertNoRelDotDot` assert the stripper verdict before scanning, so the planted file never reaches the scan and a blanked `startsWith(...)` line could not change the outcome; the test asserts the verdict message and file name |
| 5 | wrap-up | Reflect (Fresh start): the stripper-scan list is restated as prose in two places and drifted twice; pin it to the tree | deferred | Staged as backlog proposal `staged/reflect-1.md` (origin: reflect light from #3795; files: tests/helpers/strip-comments.js, .claude/skills/parse-signal-discipline/SKILL.md; trigger: next scan added or removed) |
