# Open Items — release disposition reads an unreadable staged/ as empty, then archives the run with its findings inside

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task-review minor: the Failure-section `read failed: {message}` FAILED variant (plugin/skills/release/disposition.md `## Failure`) has no pinning fact of its own in tests/release-run-dir-lifecycle-conformance.test.js — only the Inventory sentence is pinned | open | — |
| 2 | build | SDD task-review minor: a read-failure-only run is under-specified — disposition.md's "With nothing to dispose, write one `SCANNED` line" rule could still read as applicable when the only inventory outcome is a read failure, and release/SKILL.md Step 8's `findings:` line renders only "when disposition inventoried a finding", so the unreadable path may go unnamed in the summary | open | — |
| 3 | build | SDD task-review minor: disposition.md Inventory's new read-error sentence names `decisions.md` unconditionally; "that read" would tie it to the marker-gated read the next sentence describes | open | — |
