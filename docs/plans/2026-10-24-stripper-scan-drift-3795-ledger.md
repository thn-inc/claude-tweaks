# Open Items — Fix the pre-existing stripper-scan drift found during record 3773's review

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Step 2.5 pre-flight branch-divergence-check: origin/main was 1 commit ahead (d47cd98d5) at pre-flight; build's post-creation catch-up fast-forwarded the worktree to origin/main (15bc3a825). | open | — |
| 2 | build | tests/helpers/strip-comments.js header line 5 runs past the file's comment wrap width after the scan-list edit | deferred | SDD task review Minor (cosmetic); left for review/wrap-up triage |
| 3 | build | parse-signal-discipline SKILL.md item 12's `5c8e2a2e0` (#3023) line is one line longer than its neighbours | deferred | SDD task review Minor (cosmetic); left for review/wrap-up triage |
| 4 | build | path-containment planted mis-parse fixture carries no blanked startsWith(...) line, so it proves "no throw" rather than a swallowed hit | deferred | SDD task review Minor; test is red-capable without it; left for review/wrap-up triage |
