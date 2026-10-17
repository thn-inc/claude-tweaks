# Open Items — claims: extract one chained claim-reader shared by specify near-dup refusal and dispatch neighbour pass

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task-1 minor: #3393 explanatory comment sat above defaultRunGh instead of createClaimReader (claim-store.js:271-277) | fixed | 20ee3bd04 moved the comment above createClaimReader |
| 2 | build | SDD task-1 minor: createClaimReader({repoSlug: undefined}) exposes repoSlug undefined, not null | accepted | No caller passes undefined; `slug ?` and `(claims.repoSlug \|\| '')` both treat it as unresolved (final review triage: leave) |
| 3 | build | SDD task-1 minor: plugin/bin/lib/claim-targets/claim-targets.js:128 keeps its own `gh repo view` slug resolver that could reuse claim-store.js's resolveRepoSlug | open | — |
| 4 | build | SDD task-1 minor: no test for git show failing after a chained tip then falling back to the contents API | accepted | That fallback is readClaimBlob's pre-existing behaviour, unchanged by this branch (final review triage: leave) |
| 5 | build | SDD task-2 minor: AC2.1 neighbour-heredoc runtime test used no in-flight record, so read was never called | fixed | 20ee3bd04 added the AC1.1 shared-Key-File runtime case in tests/dispatch-per-record-groups-prose.test.js |
| 6 | build | SDD task-2 minor: neighbour pass AC1.1 was pinned by prose only | fixed | 20ee3bd04 (same runtime case as #5) |
| 7 | build | SDD task-2 minor: shaping-mode.md post-fence paragraph has an uneven line wrap | accepted | Cosmetic; pre-existing wrap, left unreformatted per surgical-edit rule |
| 8 | build | SDD task-2 minor: new runtime tests override PATH via spread env; on Windows the key may be `Path` | observation | Final reviewer: Node on Windows keeps the first case-insensitive key after sorting, so `PATH` should win; not run on Windows (CI is ubuntu-only) |
| 9 | build | SDD Ruling: fixed all four final-review minors in one fix wave (b5cd12e84..20ee3bd04), re-review all addressed — cost if wrong: one extra small commit | observation | — |
| 10 | build | SDD Ruling: claim-targets.js resolveRepoSlug reuse is out of scope for #3393, carried as ledger item #3 — cost if wrong: a duplicate gh repo view resolver persists | observation | — |
