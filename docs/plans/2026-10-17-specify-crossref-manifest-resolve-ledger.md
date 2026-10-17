# Open Items — specify crossReferenceKeyFiles fence depends on a shell variable not shared across Bash calls (#3161)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | tests/specify-crossref-manifest-resolve.test.js:133 go-red assert.throws has no matcher — pin /exited 1/ or /ENOENT/ so an unrelated spawn error cannot satisfy the control (SDD task-review minor) | fixed | Review: matcher /fence exited 1: [\s\S]*ENOENT/ added to the go-red assert.throws |
| 2 | build | test 1's prose pin covers the sessionTmpPath(...) call but not the `\|\| os.tmpdir()` fallback of the identical expression (SDD task-review minor) | fixed | Review: test 1 now also pins the `\|\| os.tmpdir()` fallback string |
| 3 | build | SDD pre-flight Ruling: build's maturity-established characterization-test instruction is satisfied by Task 1's own tests 2-3 plus the existing crossref prose pins — no separate characterization test | observation | Ruling recorded at SDD pre-flight |
| 4 | build | SDD Ruling: test 2 runs in a non-git cwd so the fence prints [] — stands; AC (b) asks only that the isolated fence succeeds; grep-hit behavior is pinned in tests/bin-lib/issues/decomposition-crossref.test.js | observation | Ruling recorded at task review |
