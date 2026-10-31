# Open Items — #4704 friction-events.js main-checkout union scoped to the current session

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Step 2.8 file-overlap warning: #4704 overlaps open #4522 (`plugin/bin/friction-events.js`, `plugin/bin/lib/hooks/context.js`), #4429 (`friction-events.js`, `tests/friction-events-cli.test.js`), #4259 (`friction-events.js`), #4286 (`friction-events-cli.test.js`), #3875/#3975/#4318 (`hooks/context.js`) | observation | Proceeded with #4704 only (warning, never a gate); #4522 widens the same worktree-path union #4704 narrows — expect a text conflict at whichever PR lands second |
| 2 | review | 3f low: `tests/friction-events-cli.test.js` "with no path siblings to filter, repoInfo (a git spawn) is not called" pins a call count, not behavior (refactor-coupled) | open | Staged `staged/review-1.patch` (removes the test — test-removal override, never auto-applied) |
| 3 | review | 3a/3e low: `plugin/skills/reflect/full-mode.md:169` + Known limitation stale after #4704's session scoping | fixed | 77190ff77 |
| 4 | review | 3c/3b/3g low: `friction-events.js` #4704 comment lacked the fail-open and filter-not-drop rationale | fixed | 77190ff77 |
| 5 | review | 3c low: `friction-events.js:254` main checkout + no session id dropped siblings silently | fixed | 77190ff77 — stderr diagnostic + test |
| 6 | review | 3a low: ownership predicate duplicated between friction-events.js and `findAdHocRunsBySessionId` | fixed | 77190ff77 — `isSessionOwnedAdHocRun` in context.js |
| 7 | review | 3a low: `tests/friction-events-cli.test.js:650` git init without a timeout | fixed | 77190ff77 — fixtureGit + FIXTURE_TIMEOUT_MS on the CLI spawn |
| 8 | review | 3a/3e/3f low: `tests/teardown-gate.test.js:914` hand-built deps lacked the realpath seam | fixed | 77190ff77 |
| 9 | review | 3e low: main-checkout detection spawns git (`repoInfo`) while `mainCheckoutRoot` answers it with zero subprocesses | deferred | Staged `staged/review-followup-1.md` (Defer-reason: genuinely-larger — seam swap + ~15 test fakes; overlaps #4522) |
| 10 | review | 3f low/info: miscased real-writer test skips on case-sensitive CI; fake covers the comparison | accepted | Tiebreak: no practical fix on a case-sensitive runner |
