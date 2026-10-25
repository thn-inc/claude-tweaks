# Open Items — release --as anchor still requires exact HEAD == origin, unlike Step 3 after #4012

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | wrong-branch stop row (tests/release-as-anchor-conformance.test.js:243) asserts only non-zero exit + unchanged origin, not that the branch clause caused it — same discrimination as the Step 3 suite's rows | accepted | The fixture switches to a new branch at the same commit, so the behind and tree clauses pass and only the branch clause can fail; non-zero exit is therefore attributable |
| 2 | build | no fixture row exercises the post-push checkout through the comparison step 3 pull --rebase (verified by reading only) | fixed | Added a fixture row: after the override lands, the archive-commit checkout rebases onto it and passes the review-tree check again (tests/release-as-anchor-conformance.test.js) |
| 3 | build | execute.md:114 "the reviewed tip is read the way the comparison below reads it" reads slightly awkwardly now that {tip-sha} is the checked tip — correct as stands | accepted | Wording is correct as stands; a rephrase is below the materiality floor |
| 4 | review | execute.md:104 --as push: empty {sha} from a failed commit-tree would make the push delete the branch on origin (medium, 3c) | fixed | Stop-before-push rule stated in execute.md and pinned in the conformance test (91eb77984) |
| 5 | wrap-up | pr — PR #4327 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
