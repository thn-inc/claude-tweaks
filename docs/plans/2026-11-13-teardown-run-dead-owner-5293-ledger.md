# Open Items — Merge mode cannot tear down a dispatch-parked run: teardown-run refuses a run recorded by another session (#5293)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Step 2.5 branch-divergence: origin/main was 5 ahead of local HEAD (caught up in the worktree); local main also carries 4 unpushed reconcile-archive commits that ride along into PR #5296 (pure archive renames) | open | — |
| 2 | build | SDD ruling — unlock decision reads the Step-0 listing lock state, code stands: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — cosmetic residuals routed to the Common Step 3 simplify pass: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build/skill | Adding a consumer to a shared verdict module (run-liveness) also means updating its authoritative consumer lists (docs/hooks.md, the module header), because a recorded removal condition argues from them; no project skill covers this registration step [skill: NEW - shared-verdict-consumer-registration] | observation | Skill observation for /claude-tweaks:wrap-up's Skills curation row |
| 5 | ops | Step 2.5 branch-divergence on handoff resume: origin/main is 2 ahead of HEAD (61ec59285 #5227, 51ba6c665 #4785); review's pre-review catch-up handles it | open | — |
| 6 | review | Convention (low): docs/plugin-structure.md:45 said "Three routes consume it" while listing four run-liveness consumers | fixed | 12c221e40 — now "Four routes", matching docs/hooks.md |
| 7 | review | Convention/Ownability (low): teardown-run.js header did not name the new opts.liveness seam (3a + 3g) | fixed | 12c221e40 — header comment names opts.liveness |
| 8 | review | Convention (low): tests/hooks-teardown-run.test.js re-required child_process mid-file | fixed | 12c221e40 — requires merged into the header block |
| 9 | review | Test Quality (low): dead-owner Step 3 lock branches (branch-recovered path; pid-less and in-use locks) had no test | fixed | 12c221e40 — three branch-recovered lock tests; discrimination shown by mutating the guard and the ternary (red), then restored |
| 10 | review | Test Quality (low): dead-owner remote-delete asserted by call count only | fixed | 12c221e40 — deepStrictEqual on the exact ref path |
| 11 | review | Test Quality (low): new tests leak ct-td-* temp roots via fixtureRepo() | accepted | Tiebreak recommendation drop: the same leak exists in ~25 older fixtureRepo() tests in this file and the OS reaps tmpdir; a fix belongs to the whole file, not this diff |
