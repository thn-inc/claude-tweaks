# Open Items — #4024 Select local tests by traced file reads instead of running the full suite for every plugin/** change

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — T7's trace CLI resolves the repo root from `git rev-parse --show-toplevel` of its cwd (injectable) and runs...: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | |
| 2 | build | SDD ruling — implementers run only their focused test files, not the full suite before committing: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | |
| 3 | build | SDD ruling — a mapped test absent from headTests is never selected; if a changed path's only readers are such tests the ...: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | |
| 4 | build | SDD ruling — impact-matched path with no recorded status is treated as A (broader match): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | |
| 5 | build | SDD ruling — an explicit non-impact rule naming the impact suite selects it in full (superseded): ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | |
| 6 | build | SDD ruling — fetch must pick the newest successful main map whose headSha is an ancestor of HEAD, not simply the latest: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | |
| 7 | build | SDD ruling — this repo's impact.command has no quotes/backslashes and run-tests --files-from resolves listed paths again...: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | |
| 8 | build | SDD ruling — the CI workflow runs trace WITHOUT --allow-dirty (a fresh checkout is clean): ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | |
| 9 | build | SDD ruling — root *.md and docs/** become impact rules (after the specific docs rules); .github/**, package.json and the...: ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | |
| 10 | build | SDD ruling — Build Common Step 5 is impact-selected only when scoped-eligible (run dir or --source), full standalone: ratify or reverse at the Review Console (staged/sdd-ruling-10.md) | open | |
| 11 | build | Task 1: first-non-M status merge can disagree with disk (committed A + uncommitted delete reads A) | accepted | Final review: A and D match identically, selection unaffected. |
| 12 | build | Task 1: porcelain unmerged codes (UU/AA/DU) and combined XY like AD untested | deferred | Follow-up: add changed-files.js porcelain cases. |
| 13 | build | Task 2: mapProblem treated a non-integer distance as fresh | fixed | Fixed in 1849a0333 (unknown distance reads map-stale). |
| 14 | build | Task 2: deleting a test with its only fixture always falls back full | accepted | Conservative; performance only. |
| 15 | build | Task 2: map-to-base drift — a test that began reading a file after the map commit is not selected | deferred | Follow-up: also select test files changed between map commit and HEAD; documented in impact-selection.md; CI full suite gates merge. |
| 16 | build | Task 3: isSafeMapPath accepts '.'/'./' | accepted | Fails closed (map-missing/map-invalid). |
| 17 | build | Task 3: impact+{base} refusal fires only for string-form tests | accepted | Only the string form is tool-scoped. |
| 18 | build | Task 5: files-list-unquotable / files-list-unwritable / map-unlocatable fallbacks have no committed CLI test | deferred | Follow-up: pin the three fallbacks in impact-cli.test.js. |
| 19 | build | Task 5: the map loads (and may fetch, up to 120 s) on every impact --scope run even when no impact-rule path changed | deferred | Follow-up: load lazily once selectScope needs it. |
| 20 | build | Task 5: runImpactFetch piped output it discards | fixed | Fixed in 1e8dcf07b (stdio ignore, timedOut/signal recorded). |
| 21 | build | Task 5: --stamp-suite record after an impact subset | accepted | Unreachable: --stamp-suite skips selection. |
| 22 | build | Task 6: resolver ignores require.resolve({paths}) and package.json main; bash -o pipefail -c / env FOO=1 git not parsed as shell; traces ~5x larger from resolver candidates | deferred | Follow-up tracer hardening; documented as approximated. |
| 23 | build | Task 7: a header-less trace file is dropped and trace still writes the map (plan-mandated) | deferred | Follow-up: refuse or flag the map when headerless > 0. |
| 24 | build | Task 7: fetch cache check compares commit only; a fresher local map is overwritten by an older ancestor CI map | deferred | Follow-up (performance). |
| 25 | build | Task 7: readFileList duplicate check before normalization; ../ or absolute entries accepted | accepted | verify writes the list from HEAD test paths. |
| 26 | build | Task 7: no test for 0/2+ json artifacts or a parse-failing artifact; e2e trace test does not assert clean stderr | deferred | Follow-up tests in test-impact-cli.test.js. |
| 27 | build | Task 7: an --allow-dirty map is indistinguishable from a clean one; an interrupted trace leaves its temp dir | deferred | Follow-up (map field + signal cleanup). |
| 28 | build | Task 7: Windows — NODE_OPTIONS strips backslashes inside quotes; large --files-from lists may exceed the command line | deferred | Follow-up; documented as POSIX-only tracing. |
| 29 | build | Task 8: tools/test-impact.js sits under tools/** (impact) though its trace builds the map | accepted | Fail-safe either way. |
| 30 | build | Task 8: {files} doc omits path-side refusals (leading dash, control char, cmd-unquotable) | deferred | Follow-up doc clause. |
| 31 | build | AC6: median verify minutes per pipeline (timing.json) below 1 across the next 20 runs — a post-merge measurement, not observable in this build | open | |
| 32 | build | The new test-impact-map workflow has not yet run on a real runner — the PR's pull_request run (tracer paths changed) must be green before merge | open | |
