# Open Items — release disposition reads an unreadable staged/ as empty, then archives the run with its findings inside

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task-review minor: the Failure-section `read failed: {message}` FAILED variant (plugin/skills/release/disposition.md `## Failure`) has no pinning fact of its own in tests/release-run-dir-lifecycle-conformance.test.js — only the Inventory sentence is pinned | fixed | Added a DISPOSITION_APPROVAL fact for the `read failed: {message}` variant — afcac0400 |
| 2 | build | SDD task-review minor: a read-failure-only run is under-specified — disposition.md's "With nothing to dispose, write one `SCANNED` line" rule could still read as applicable when the only inventory outcome is a read failure, and release/SKILL.md Step 8's `findings:` line renders only "when disposition inventoried a finding", so the unreadable path may go unnamed in the summary | fixed | SCANNED now requires no read failure; `findings:` line renders for a failure too (disposition.md, release/SKILL.md Step 8), both pinned — afcac0400 |
| 3 | build | SDD task-review minor: disposition.md Inventory's new read-error sentence names `decisions.md` unconditionally; "that read" would tie it to the marker-gated read the next sentence describes | fixed | Sentence now names "the `decisions.md` read below"; pin regex updated — afcac0400 |
| 4 | wrap-up | pr — PR #4262 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
| 5 | wrap-up | residue suite probe — skipped via --no-suite (the fact pack never re-runs the suite) — the run's own verify.js pass at b1ab225f3 (16874 tests, 0 fail) stands in | observation | — |
