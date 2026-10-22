# Open Items — #3866: pr-first-merge Step 4.2 logs to the run dir after reconcile archived it, recreating the dir

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task-review minor: Step 4.2 "log to the path resolved above" leaves the non-archived fallback (`$PIPELINE_RUN_DIR`) implicit — add "(else `$PIPELINE_RUN_DIR`)" | deferred | Origin: SDD Task 1 review (commit b88fa55). Files: plugin/skills/_shared/pr-first-merge-post-merge.md (Step 4.2). Trigger: this run's /review phase — fix-now candidate per _shared/deferral-gate.md |
| 2 | build | SDD task-review minor: #3866 test does not assert the "other run dir(s)" line points at the resolved path — reverting that clause still passes | deferred | Origin: SDD Task 1 review (commit b88fa55). Files: tests/pr-first-merge.test.js. Trigger: this run's /review phase — fix-now candidate per _shared/deferral-gate.md |
| 3 | build | SDD task-review minor: rewrap leaves an orphaned short line at "Either way" in Step 4.2 | deferred | Origin: SDD Task 1 review (commit b88fa55). Files: plugin/skills/_shared/pr-first-merge-post-merge.md. Trigger: this run's /review or polish phase — cosmetic |
