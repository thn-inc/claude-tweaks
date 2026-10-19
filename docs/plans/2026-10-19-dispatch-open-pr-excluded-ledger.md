# Open Items — dispatch: queue-pull-script.md redirects to undeclared $DISPATCH_OPEN_PR_EXCLUDED

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task review minor: the `$DISPATCH_*` conformance scan covers the whole markdown file incl. prose, so a future prose mention of an undeclared name would fail the test (tests/bin-lib/dispatch/exclusions.test.js) | observation | Latent, fails loudly not silently; no such prose mention exists today. Recorded as observation rather than `deferred` (no staged record proposal) — below the materiality floor. |
| 2 | build | SDD task review minor: assignment regex matches only line-start `KEY=`, so an `export`/`local DISPATCH_X=` form would false-positive as undeclared (tests/bin-lib/dispatch/exclusions.test.js) | observation | False-positive risk only (loud), script uses neither form today; below the materiality floor. |
| 3 | build | SDD task review minor: conformance test lives in exclusions.test.js (module-focused neighbours) rather than a script-conformance file | observation | Placement mandated by the spec's Deliverable 2; reviewer did not count it as a defect. |
| 4 | wrap-up | pr — PR #3567 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | Own deliverable, open by design until the merge decision. |
| 5 | wrap-up | residue suite probe not run (skipped via --no-suite) | observation | Suite state taken from the runner stamp instead: full pass at 38a1ce431 (13033 tests, 0 failures); a full re-verify at the final HEAD follows in Phase 4. |
| 6 | wrap-up | Skills row: exclusions.test.js read the governed script with a private fs.readFileSync instead of tests/helpers/read-skill.js's readText | fixed | Aligned to the skill-prose-conformance-tests convention in 86fbabef2; exclusions.test.js 16/16. |
