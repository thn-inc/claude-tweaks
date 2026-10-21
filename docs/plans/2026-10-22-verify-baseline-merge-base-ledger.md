# Open Items — verify.js baseline adjudication blames a branch for failures inherited from its merge-base

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD Task 1 minor: shallow clone whose fork point is not fetched reported a misleading 'no merge-base' reason | fixed | a49896d27 — shallow-specific reason via realGit.isShallow + verification.md reworded; CLI test on a file:// --depth 1 clone |
| 2 | build | SDD Task 1 minor: realGit.mergeBase returned null for any git failure, so a transient error read as 'no merge-base' | fixed | a49896d27 — null only on exit 1, other failures rethrow into the adjudication-error path; merge-base computed lazily |
| 3 | build | SDD Task 1 minor: no direct unit test for realGit.mergeBase | accepted | Superseded by SDD ruling row #7 — CLI tests exercise both outcomes against real git |
| 4 | build | SDD Task 2 minor: snippet-conformance #3810 test pinned only 'git merge-base HEAD {ref}' and 'baseRef' | fixed | a49896d27 — test also pins vs {baseRef}, the no-merge-base case and the shallow-clone reason |
| 5 | build | SDD Task 2 minor: journey 'the Baseline: line names its sha' held on eligible runs only | fixed | a49896d27 — scoped to an adjudicated run |
| 6 | build | SDD ruling — baselineAdjudicated.base stays the ref string on the runner's own refusals (merge-base SHA only when adjudication ran): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 7 | build | SDD ruling — no direct realGit.mergeBase unit test added (CLI tests cover both outcomes): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
