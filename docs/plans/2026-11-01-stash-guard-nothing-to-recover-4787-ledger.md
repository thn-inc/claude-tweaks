# Open Items — Stash guard: report a store that wrote nothing without a recover command (#4787)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | stash-guard.js `otherCommand`'s `x.failed.command !== null` clause is dead (null outcomes are created after it is computed) | fixed | Removed the clause in 09c172ee2 (review) |
| 2 | build | FAILED decisions.md line for the "run it after the other recover commands" error is not pinned by a test (JSON + stderr are) | fixed | Pinned in the held-entry test in 09c172ee2 (review); shown red by a mutation that drops the recover clause from the line |
| 3 | build | When the only other recover command is for another copy of the same on-top sha, the "run it after" command also writes nothing (exotic stack shape) | deferred | Defer-reason: needs-human-decision — fix-now eligible, surfaced by the residual fix's scoped re-review after the one authorized fix dispatch was spent |
| 4 | review | handoff-template.md lists recover entries in `restoreFailed` array order, so a pasted held entry runs before the commands it waits on and silently writes nothing | fixed | Template note now says to list in stderr print order, held entry last — 325cd3255 (review, tiebreak-confirmed low) |
| 5 | review | The empty post-store stack branch of the held-outcome guard (`after[0] &&`) had no test | fixed | Added the empty-stack no-op store test in 325cd3255; shown red by dropping the `after[0] &&` guard (review, tiebreak-confirmed low) |
| 6 | review | A post-store re-read failure after a nothing-written store counts the entry as restored, against the header's "never counted as restored" | accepted | Deliberate (inline comment: a failed re-read cannot refute the exit code) and pinned by tests/stash-guard.test.js; the header wording predates this diff (review, tiebreak-confirmed info, drop) |
| 7 | review | The replay test runs the printed commands as argv, not through a shell | accepted | The test checks print order; escaping is pinned byte-exact by AC5.1 (review, tiebreak-confirmed low, drop) |
