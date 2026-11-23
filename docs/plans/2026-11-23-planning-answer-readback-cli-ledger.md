# Open Items — Move /specify planning-answer read-back and outcome selection into a tested CLI

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch divergence: origin/main was 17 commits ahead of local HEAD at Step 2.5 | fixed | Post-creation catch-up merged origin/main into the worktree branch (6adac5c to e4e2f18) before any build commit |
| 2 | build | SDD ruling — Task 3 Step 5 control reads the task BASE, not HEAD~: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — readBack plan-line check counts every unfenced Plan: line in the body: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — keep the unreachable --labels-file gh-absent clause: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — plan-mandated bare plan-store.js check fixed to the node-prefixed form: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | review/ownability | medium Ownability — resolved-id dual match (planning-hold.js:204) had no comment explaining gh node id vs REST/MCP numeric id | fixed | fixed in 8c0e2bc37 (review Step 3 Routing, AUTO) |
| 7 | review/ownability | low Ownability — plan-check file swallow (bin/planning-hold.js:128) had no comment at the swallow site | fixed | fixed in 8c0e2bc37 (review Step 3 Routing, AUTO) |
| 8 | review/ownability | low Ownability — plan-line tolerances (planning-hold.js:221) carried no rationale comment | fixed | fixed in 8c0e2bc37 (review Step 3 Routing, AUTO) |
| 9 | review/ownability | low Ownability — failed-outcome asymmetric routing (planning-hold.js:250) had no comment (contested position B, debate partial/partial, tiebreak confirmed) | fixed | fixed in 8c0e2bc37 (review Step 3 Routing, AUTO) |
| 10 | review/test-quality | medium Test quality — rehold length check (planning-hold.js:193) untested | fixed | fixed in cfbdd7f62 (review Step 3 Routing, AUTO) |
| 11 | review/test-quality | low Test quality — --labels-file precedence (bin/planning-hold.js:118) untested with differing label sets | fixed | fixed in cfbdd7f62 (review Step 3 Routing, AUTO) |
| 12 | review/test-quality | low Test quality — kept branch with neither label (planning-hold.js:184) untested | fixed | fixed in cfbdd7f62 (review Step 3 Routing, AUTO) |
| 13 | review/test-quality | low Test quality — argv rejections (bin/planning-hold.js:59): non-numeric --record, malformed --other-unresolved, non-string reheld element untested | fixed | fixed in cfbdd7f62 (review Step 3 Routing, AUTO) |
| 14 | review/test-quality | low Test quality — multi-element --resolved-ids (bin/planning-hold.js:131) untested | fixed | fixed in cfbdd7f62 (review Step 3 Routing, AUTO) |
| 15 | review/test-quality | low Test quality — re-held outcome test could not tell {j} from {k} (planning-hold.js:255) | fixed | fixed in cfbdd7f62 (review Step 3 Routing, AUTO) |
| 16 | review/test-quality | info Test quality — test named for {name} label objects never fed them (tests/planning-hold-cli.test.js:164) | fixed | fixed in cfbdd7f62 (review Step 3 Routing, AUTO) |
| 17 | ops | PR #6104 is CONFLICTING again after review: origin/main gained dbf1349cee (#6101), which edits plugin/skills/specify/planning-answer.md, tests/specify-planning-answer-conformance.test.js and conflicts in docs/journeys/answer-a-record-held-for-planning-questions-6059.md — merge origin/main, reconcile #6101's gh-absent comment-edit change with this branch's read-back rewrite, re-verify before the merge gate (reason-not-auto: semantic merge of a sibling's edit to the same skill section) | open | — |
