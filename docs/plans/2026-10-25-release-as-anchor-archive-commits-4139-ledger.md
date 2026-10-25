# Open Items — release --as anchor still requires exact HEAD == origin, unlike Step 3 after #4012

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | wrong-branch stop row (tests/release-as-anchor-conformance.test.js:243) asserts only non-zero exit + unchanged origin, not that the branch clause caused it — same discrimination as the Step 3 suite's rows | deferred | — |
| 2 | build | no fixture row exercises the post-push checkout through the comparison step 3 pull --rebase (verified by reading only) | deferred | — |
| 3 | build | execute.md:114 "the reviewed tip is read the way the comparison below reads it" reads slightly awkwardly now that {tip-sha} is the checked tip — correct as stands | deferred | — |
