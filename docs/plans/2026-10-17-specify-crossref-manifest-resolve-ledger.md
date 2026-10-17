# Open Items — specify crossReferenceKeyFiles fence depends on a shell variable not shared across Bash calls (#3161)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | tests/specify-crossref-manifest-resolve.test.js:133 go-red assert.throws has no matcher — pin /exited 1/ or /ENOENT/ so an unrelated spawn error cannot satisfy the control (SDD task-review minor) | fixed | Review: matcher /fence exited 1: [\s\S]*ENOENT/ added to the go-red assert.throws |
| 2 | build | test 1's prose pin covers the sessionTmpPath(...) call but not the os.tmpdir() fallback of the identical expression (SDD task-review minor) | fixed | Review: test 1 now also pins the os.tmpdir() fallback string |
| 3 | build | SDD pre-flight Ruling: build's maturity-established characterization-test instruction is satisfied by Task 1's own tests 2-3 plus the existing crossref prose pins — no separate characterization test | observation | Ruling recorded at SDD pre-flight |
| 4 | build | SDD Ruling: test 2 runs in a non-git cwd so the fence prints [] — stands; AC (b) asks only that the isolated fence succeeds; grep-hit behavior is pinned in tests/bin-lib/issues/decomposition-crossref.test.js | observation | Ruling recorded at task review |
| 5 | wrap-up | pr — PR #3445 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | Own PR, open by design |
| 6 | wrap-up | residue sweep suite probe skipped via --no-suite — suite state taken from the runner stamp (verifiedHead true at b2671ed58, baseline-adjudicated; one load-sensitive timing flake in tests/bin-lib/gif/palette.test.js) | observation | Probe deliberately skipped; see report.json |
| 7 | wrap-up | Test-only fix after the verified stamp: LF-normalize the skill text before fence extraction (80c03af19); the full-suite stamp covers b2671ed58, not HEAD | observation | Re-verified targeted (see decisions.md); CI is the authoritative gate |
