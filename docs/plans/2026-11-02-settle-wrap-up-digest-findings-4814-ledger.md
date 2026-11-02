# Open Items — Settle 5 digest findings in wrap-up

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Same whole-file `record:` read as #4814's fifth finding, outside this record's named sites: `plugin/bin/lib/dispatch/first-call-artifact-check.js:116`, `plugin/skills/tidy/issue-claims-backstops.md:105` (line 104 greps `parked-at-shaping` across the whole file too) | deferred | Defer-reason: pre-existing-outside-diff — neither file is in this build's diff; below floor, routed to the digest: https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6573251738 |
| 2 | build | SDD ruling — merge mode spec-{n} slug never matches a dispatch-minted record-{n} run: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | review | Lens 3f (tiebreak confirmed, low): the engine-verify test title at tests/bin-lib/wrap-up/engine-verify.test.js:2003 still named the old `missing demo:pending line` | fixed | Title renamed to `missing pending-label line` (6b65c4a0c) |
| 4 | review | Lens 3f (tiebreak can't-tell, medium): the non-array pack fixtures (tests/wrap-up-closing-records-array-fill.test.js:160) carried record 101, the same as the mirror record, so a guard that coerced a scalar instead of exiting read the same | fixed | Fixture values changed to 909 so a coercing guard reads red (6ce593e9d); applied inline rather than left at the console |
| 5 | review | Lens 3f (tiebreak confirmed, info): the single-`resolve-run-dir` count test at tests/wrap-up-merge-mode-conformance.test.js:202 counts bare substrings | accepted | The `resolve-command` fact in the same file pins the `--archived` command shape, so the one mention is that call; a future prose mention fails loudly and cheaply (tiebreak: drop) |
| 6 | review | Lens 3f (tiebreak confirmed, info): the NON_ARRAY fall-through tests pass on the pre-change code | accepted | Intended: the Section C guard was already correct and the finding the record settles is the missing coverage for it (tiebreak: drop) |
| 7 | wrap-up | pr — PR #4966 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
| 8 | wrap-up | suite — the residue sweep's suite probe was skipped via --no-suite; this run's suite state is the verification stamp's (runner stamp 67739abf8 scoped: tests 9835/9835, journeys 79/79) | observation | — |
