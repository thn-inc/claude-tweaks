# Open Items — review: the pre-dispatch untracked-file baseline cannot be written from a worktree-isolated session (#3302)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD Task 1 minor: `realLsof` set no timeout/maxBuffer — a hung `lsof` would block `build` (raised to Important by final review) | fixed | `timeout: 10000`, `maxBuffer: MAX_BUFFER`, quiet stderr — `5a1360ef1` |
| 2 | build | SDD Task 1 minor: F2 fake-git test ran the real `lsof` (not hermetic) | fixed | `lsof: () => ''` stub added — `5a1360ef1` |
| 3 | build | SDD Task 2 minor: `step3-debate-and-refutation.md:147` still said `step3-lens-dispatch.md` "captures" the baselines | fixed | reworded to "its `build` call writes" — `5a1360ef1` |
| 4 | build | SDD parked (final-review Minor #6): the no-hand-write negative test only catches `>` redirects; a `tee`/Write phrasing would pass | observation | — |
| 5 | build | SDD parked (final-review Minor #7 / Task 1 minor): `plugin/bin/build-review-context.js:7` header comment is an unwrapped 140-char line — cosmetic | fixed | rewrapped by review Step 5 simplify |
| 6 | review/3c+3a | Leftover-listener check keyed on `pre-dispatch-listeners.txt` existing — a file left in a reused `--run` review-ctx dir by an earlier build survives a later `lsof` failure and yields phantom "new listeners" | fixed | check now keyed on `listenersPath` non-null — `1f6319831` |
| 7 | review/3a+3c | SKIP log said "lsof unavailable" for a timeout/other failure too (`realLsof` returns `null` for all) | fixed | wording "unavailable or failed" in prose, conformance test, and the 3001 journey — `1f6319831` |
| 8 | review/3f | No-hand-write test caught only the `> {ctx-dir}/` redirect form (matches parked row 4) | fixed | prose.test.js and conformance test also pin "Never write either file by hand" and reject `tee`/Write-tool phrasing — `1f6319831` |
| 9 | review/3c | `realLsof` treats exit 1 as "no listeners" even when it was a failure (stderr is dropped) — an empty baseline then reports every listener as new at the sweep | observation | accepted: the sweep is report-only, and the exit-1 mapping is the documented lsof no-match contract |
| 10 | review/3f,3c | Low/info test-hygiene observations: CLI e2e tests spawn the real `lsof` (`build.test.js:133`); no test for the `git status` capture failure path (`build.js:208`); `multi-agent-coordination.test.js:1494` title says "captures"; `listenersPath: null` not noted in the header comment/`docs/plugin-structure.md` | observation | single-agent or info findings, none affecting behavior |
