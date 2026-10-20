# Open Items — #3563 Premise-check runner resolves a POSIX shell on Windows

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Task 1 minor: injected-exec seam test pinned only the exit-0 path; non-zero-status and re-throw paths covered only via real-shell tests | fixed | a269e3169 adds the injected-exec status/re-throw test (final-review Minor 2) |
| 2 | build | Task 1 minor: test 7's AC5.1 assertion runs the composed command twice (defaultRunner, then premiseReadsUnresolved) | accepted | Plan-mandated, harmless; final whole-branch review triaged it as accept |
| 3 | build | Task 2 minor: cli-validate-findings defaultRunner assertions use cwd: top, so a wrong cwd would also read unresolved — cannot prove the cwd contract | accepted | Pre-existing gap, not introduced here; the top-level-vs-subdir distinction is pinned elsewhere in the same tests (final-review triage) |
| 4 | build | Task 2 minor: edited test-side assertions prove exit 0 only under an honest runner | accepted | premise-self-check.test.js pins defaultRunner directly (final-review triage) |
| 5 | build | Task 3 minor: parity-skill row's Why cell wraps "resolved" in straight double quotes | accepted | Brief-verbatim style only (final-review triage) |
| 6 | build | Final-review Minor 3: on win32 a bare 'sh' resolves via libuv search_path, which checks the child's cwd (checkout root) before PATH, so a repo-root sh.exe would interpret Premise-check commands | observation | Ruling: code stands — the plugin already runs checkout code (tests, hooks) and the spec mandates PATH-resolved sh |
| 7 | build | Final-review declined-to-judge: Node→MSYS argv quoting for a Premise-check command whose anchor contains a double quote or backslash is unverified on Windows and unexercised even by the windows-latest run; a mangled command reads satisfiedAtBase:true in materialize.js (a staged close proposal on a Windows build). Files: plugin/bin/lib/health-core/premise-self-check.js, plugin/bin/lib/harness-health/issue-payload.js (buildPremiseCheck), tests/bin-lib/health-core/premise-self-check.test.js | open | — |
