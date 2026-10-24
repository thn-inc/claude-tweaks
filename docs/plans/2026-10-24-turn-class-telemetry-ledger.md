# Open Items — Track turn classes, context size and ceremony share per run, and flag budget regressions

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — fixture creation moved from plan Task 3 to Task 2 (Task 2's test consumes it first): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — render expectations corrected to the plan's own stated rounding rules (p50 5.0k; the share later became 45% under the final review's integer-count rule M2): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — subagents-golden-plain.md left unchanged (the no-transcript render has no guard block, so the new lines cannot appear there): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — AC3.1 met by exact reproduction (79 / 407) on the analysis's 143-run archive, plus independent-probe agreement on today's 146-run archive (78 / 403): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — repeat-breach fold: stable per-profile title, work-fingerprint efficiency-budget:{profile}, open-record gh lookup before staging (fail-open), multi-spec stages into the parent run dir: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | Final review parked: the refusal cap `[^\n]{0,300}` misses long "Permission to use … has been denied" texts | fixed | Widened to `{0,1500}` before Common Step 5 (the 2,048-char slice already bounds the cost); a 400-char-command test row went red at `{0,300}`, green at `{0,1500}` |
| 30 | build | Pre-existing on-branch failure: `tests/git-status-optional-locks.test.js` flagged the `GIT_ORIENTATION` Set literal in turn-class.js, whose first element was `'status'` (the scanner reads `['status'` as a git argv) | fixed | Reordered the Set so `'rev-parse'` leads; the scanner test is green |
| 31 | build | Common Step 5 full run: `tests/git-path-read-conformance.test.js` (2 cases) flagged the `GIT_EXPLORE` Set literal, whose `'ls-files'`/`'ls-tree'` tokens read as a path-list argv | fixed | Added the scanner's own `// git-path-read: not a path list (…)` exemption marker to that line |
| 7 | build | Task 1 minor: `cd /r; git commit` classified `other` (a `cd` hop was stripped only before `&&`) | fixed | Final fix wave 4349a8558 (M5) |
| 8 | build | Task 3 minor: ceremony share rounded from the 3dp float | fixed | Final fix wave 4349a8558 (M2: integer counts) |
| 9 | build | Task 3 minor: no test for unknown turn-class keys folding into `other` | fixed | Final fix wave 4349a8558 (M6) |
| 10 | build | Task 3 minor: "over 1 turns" had no singular form | fixed | Final fix wave 4349a8558 (M3) |
| 11 | build | Task 4 minor: procedure-KB summaries said "may load" | fixed | Final fix wave 4349a8558 (M4: "may read") |
| 12 | build | Task 5 minor: the staged-but-log-failed branch was untested | fixed | Final fix wave 507d23bc9 (I2) |
| 13 | build | Task 6 minor: degrade cases left no SKIP trace | fixed | Final fix wave 507d23bc9 (I2: the CLI writes SKIP; empty run dir is listed in the handoff) |
| 14 | build | Task 6 minor: a later `phase-timing --markdown` rewrite dropped the `budget` key | fixed | Final fix wave 4349a8558 (M1: carried forward) |
| 15 | build | Task 1 minor: a bare `&` splits segments, so `2>&1` yields stray tokens | accepted | Harmless for every classified head (final review triage) |
| 16 | build | Task 1 minor: path-prefixed test runners classified `other` | accepted | Premise false: the final review verified that `./node_modules/.bin/jest --ci` classifies `verify` |
| 17 | build | Task 1 minor: the `git worktree prune` fall-through to `other` is not pinned by a test | accepted | Trivial; accepted at final review triage |
| 18 | build | Task 1 minor: a missing space after a comma in a test row | accepted | Cosmetic; accepted at final review triage |
| 19 | build | Task 2 minor: new transcript tests leave mkdtempSync dirs | accepted | The test runner gives each run a private TMPDIR, removed on exit (tools/run-tests.js #3969) |
| 20 | build | Task 2 minor: the subagent readUsage call passes no worktree | accepted | Premise false: absolute skill paths match without a worktree, and subagent rows never feed turnClasses |
| 21 | build | Task 5 minor: a re-run that no longer breaches leaves the earlier staged proposal | accepted | Totals only grow within a run, and wrap-up runs the check once; the staged text is true for the check that wrote it |
| 22 | build | Task 5 minor: a re-run with a changed breach set leaves the first STAGED line naming the old metrics | accepted | The staged file is authoritative (final review triage) |
| 23 | build | Task 5 minor: `writeStagedItem` called directly bypasses the stage-item.js `sanitizeId` | accepted | Matches the verify.js:1084 precedent; run ids are generated |
| 24 | build | Task 6 minor: the conformance test uses a string replacer; the SKIP line has no go-red control | accepted | `$P`/`${` are not special in replacement strings (final review triage) |
| 25 | build | Task 7 minor: a symlinked archive entry is followed; `--help` is untested; the profile string is unescaped in the table | accepted | Maintainer-side, read-only tool over local state (final review triage) |
| 26 | build | Final minor: SKIP degrade lines are not deduplicated on a re-run (STAGED is) | accepted | Wrap-up runs the check once; cosmetic |
| 27 | build | Real-input probe: main transcript 88e831e2 gave readUsage class sum 2317 = toolRoundTrips 2317 = an independent count of timestamped tool_result blocks; 1387 more sit on api-request-blob snapshot lines (correctly skipped) | observation | Ceremony share on that session: 33.5% |
| 28 | build | AC3 live run: `tools/efficiency-report.js` on 146 runs prints median minutes 78 · median round trips 403; on the analysis's 143 runs it reproduces 79 / 407 exactly | observation | Independent controller probe agrees |
| 29 | build/skill | review-console-section-addition extends: adding a staged-id prefix to an existing SECTION_MAP section touches only sites 2 and 3, plus the known-prefix case in resolve.test.js. The skill's table is section-oriented and does not state that minimal subset | observation | — |
