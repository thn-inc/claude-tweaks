# Open Items — #3866: pr-first-merge Step 4.2 logs to the run dir after reconcile archived it, recreating the dir

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task-review minor: Step 4.2 "log to the path resolved above" leaves the non-archived fallback (`$PIPELINE_RUN_DIR`) implicit — add "(else `$PIPELINE_RUN_DIR`)" | fixed | Fixed in review: Step 4.2 now reads "(else `$PIPELINE_RUN_DIR`)" after "the path resolved above" |
| 2 | build | SDD task-review minor: #3866 test does not assert the "other run dir(s)" line points at the resolved path — reverting that clause still passes | fixed | Fixed in review: test asserts the other-run log line targets the resolved path (discrimination probed against HEAD text: new assertion false there) |
| 3 | build | SDD task-review minor: rewrap leaves an orphaned short line at "Either way" in Step 4.2 | fixed | Fixed in review: rewrapped the Step 4.2 paragraph, no orphaned short line |
| 4 | wrap-up | pr — PR #3964 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | Resolved at Phase 4: record carries auto:build only (no auto:merge), so the PR stays open as pending-review |
| 5 | wrap-up | suite probe — residue.js ran with --no-suite — suite state taken from the runner stamp (full match at 4093a5c, one known-flaky wall-clock test retried and passed) | observation | Fact pack never re-runs the suite; the verify.js pass stamp is the evidence |
