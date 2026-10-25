# Open Items — run-tests --files-from subset lane skips the ownership check on its fixed-name slot parent directory

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task-review minor: on the full-suite lane, `ensureOwnDir` now runs on the slot base twice (main block `tools/run-tests.js:455` + `acquireSlot` `:309`) | accepted | Idempotent, costs one lstat; the plan put the call here on purpose so `slotLane` stays pure and `acquireSlot`'s signature is unchanged. |
| 2 | build | SDD task-review minor: the comment "fixed-name slot base" (`tools/run-tests.js:453`) is loose when `CT_TEST_SUITE_SLOT_DIR` overrides the base | accepted | The default path is the fixed-name one, and the default is the actual shared-/tmp risk. The override is a test/maintainer knob. Cosmetic only. |
| 3 | build | SDD task-review minor: the new test's `doesNotMatch(stdout, /tests \d/)` is a loose "no run started" proxy, and its stderr/no-`subset` asserts were not independently proven red | accepted | The status assertion is proven discriminating: a controller re-run against the pre-fix runner gave `not ok 1`, expected non-zero, actual 0. The other asserts pin the refusal's shape on the fixed code. |
