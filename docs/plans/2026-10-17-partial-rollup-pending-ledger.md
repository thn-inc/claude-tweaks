# Open Items — #3405 Merge-verification reads a partial check rollup as green before every workflow has registered

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | classify.js header lead-in "Additions the merge gate does not need" also listed headRuns, which the merge gate does need | fixed | Moved to its own "Shared with the merge gate" paragraph in final fix wave 2f8f2b429 |
| 2 | build | failing/pending can name the same check twice when a rollup job and a head-run workflow share a name (state unaffected) | deferred | SDD minor (deferred), cosmetic; no staged proposal yet — wrap-up to stage or accept |
| 3 | build | no test pins a head-run row with missing status or a non-object row (both fail safe to pending) | deferred | SDD minor (deferred); no staged proposal yet — wrap-up to stage or accept |
| 4 | build | pr-checks.js called gh run list even when headRefOid != localHead, turning `stale` into `read-failed` on a transient failure | fixed | Stale guard + CLI test in 2f8f2b429 |
| 5 | build | no CLI-level test for a failing head run turning a green rollup red | fixed | Test added in 2f8f2b429 (explicit empty run list stays covered by the default fake) |
| 6 | build | Ruling: pr-check-gate.md sentence re-pointed to cite Step 2.5's head-run cross-check once Task 3 stated it | observation | Done in 3fda3ab11 |
| 7 | build | a failing head run is not acted on during the bounded watch while the rollup is still pending (8) branch) — red is seen at the RC=0 re-read or at the bound | deferred | SDD minor (deferred), delay not wrongness; no staged proposal yet — wrap-up to stage or accept |
| 8 | build | "a partial rollup … is not green" stated twice in Step 2.5 | deferred | SDD minor (deferred), cosmetic; no staged proposal yet — wrap-up to stage or accept |
| 9 | build | PR_FIRST_BYTE_CEILING re-baselined for the head-run prose (31,304 → 34,022; file 33,522 B) | observation | #2320 precedent; 2f8f2b429 sets comment baseline to the measured size |
| 10 | build | resume-confirmation.md:43 sourced resume CI status from the rollup only | fixed | Head-run read added in 2f8f2b429 (also release/execute.md, tidy/actions-github-issues.md, dispatch/close-out.md) |
| 11 | build | Ruling: residual race — a pull_request run not yet created still leaves a partial rollup green; requiring an event:pull_request run under hasPullRequestCi was declined (would hold path-filtered PRs pending to the 15-minute park) | observation | Needs a follow-up record at wrap-up |
