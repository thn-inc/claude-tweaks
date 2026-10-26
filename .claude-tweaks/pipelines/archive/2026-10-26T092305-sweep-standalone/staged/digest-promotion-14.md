# Staged: Propose digest cluster — tools (4 entries)

**Source:** digest container #1426, 4 un-promoted entries sharing `{area}` = `tools`.

**Proposed:** file one backlog record absorbing them; on approval append `→ #{new}` to each promoted entry line in #1426.

## Proposed record: Settle 4 below-floor digest findings in tools

### Current State

Digest #1426 holds 4 below-materiality-floor findings in `tools`, accumulated by review/reflect/wrap-up runs and never promoted.

### Deliverables

- [tools] run-tests.js win32 glob branch is pinned by argv shape only, not by file-set parity with listTestFiles (a parity test needs fs.globSync, Node >= 22; ubuntu CI runs Node 20) — tools/run-tests.js:75, tests/package-json-test-script.test.js — Defer-reason: blocked-dependency — 2026-10-17T110950-record-3316
- [tools] windows-regression file-issue.js re-declares TAP regexes that already differ in whitespace handling from extract.js while claiming byte-for-byte parity — tools/windows-regression/file-issue.js:204 — Defer-reason: pre-existing-outside-diff — 2026-10-24T152958-release-standalone (release v6.153.0 gate, staged/review-14.md)
- [tools] test-impact fetch reports already current for a cached map at the CI sha without checking its exitCode, so a failing-suite cache pins full runs until main moves — tools/test-impact.js:235 — Defer-reason: pre-existing-outside-diff — 2026-10-24T152958-release-standalone (release v6.153.0 gate, staged/review-20.md)
- [tools] tools/test-impact.js exports a run({ argv, deps }) seam instead of the run(argv, deps) CLI shape — tools/test-impact.js:279 — Defer-reason: pre-existing-outside-diff — 2026-10-24T152958-release-standalone (release v6.153.0 gate, staged/review-26.md)

### Acceptance Criteria

- Each Deliverables entry is fixed, or explicitly dropped with a one-line reason in this record.
- Each promoted entry line in #1426 carries `→ #{this record}`.
