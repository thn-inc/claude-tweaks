# Open Items — Write down two recurring conventions: inform-tier lines name their relay; path guards compare case-canonical paths (#3419)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Task 1 (SDD minor): implementer concern — donts.md [IL-150] clause join reads awkwardly at the brief insertion point | deferred | — |
| 2 | build | Task 1 (SDD minor): donts.md [IL-150] bullet opens "mirror realTarget()" yet ends "never the JS fs.realpathSync" while realTarget() itself uses the JS form (pre-tool-use.js:416) — scope the mirror to leaf handling | deferred | — |
| 3 | build | Task 1 (SDD minor): hooks.md relay rule reads as present-tense fact; port-services lease line, worktree-always verdict line and the #803 residue banner (session-start.js:146, carries runnable close-run) do not yet say "never run it yourself" | deferred | — |
| 4 | build | Task 1 (SDD minor): conformance test 1 pins the heading phrase, not a reworded restatement; test 3 does not pin PR #3406 or the realTarget() JS-form note | deferred | — |
| 5 | review | 3a/3i (low, direct-verified): IL-150's casing-instance paragraph cited 722ece0d6, a pre-squash branch commit reachable from no ref (`git branch -a --contains` empty; #3380's ledger is absent from origin/main) — the citation dies at the next gc; PR #3406 squash-merged the fix as ffe20b982 | fixed | fixed in 1d670479e — cites PR #3406 / ffe20b982; conformance test 3 pins ffe20b982; scoped re-verify green at 1d670479e (palette.test.js timing flake retried green in isolation) |
