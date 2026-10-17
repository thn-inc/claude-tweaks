# Open Items — Flaky-retry's unattributedFailureCount has no accounting guard for the summary family (#3204)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Record #3204's `## Release Note` understates the change — flaky retry is now spec/TAP-only; jest/vitest/pytest failures refuse with `no-accounting-guard: summary` and route to a whole-suite re-run. Revised note staged at `staged/release-note-3204.md` (SDD final review, Important 1); `compose-subject.js` reads the note from the record body, so it must be applied before merge | open | — |
| 2 | build | Follow-up record needed: restore summary-family flaky retry via per-dialect accounting — jest (`FAIL` file lines vs `Test Suites: N failed`) and vitest (`Test Files N failed` plus an `Errors` line check); pytest still refuses because collection `ERROR`s sit outside any `FAILED` line (SDD final review, Important 3; refs #3204) | open | — |
| 3 | build | Follow-up record needed: `plugin/bin/lib/verify/pre-existing.js` `matchPreExisting` adjudicates a run as passing when every named failing file matches `preExisting`, with no unattributed-failure accounting for any family — the same class of gap #3066/#3204 closed for flaky retry (SDD final review, declined-to-judge; refs #3129) | open | — |
