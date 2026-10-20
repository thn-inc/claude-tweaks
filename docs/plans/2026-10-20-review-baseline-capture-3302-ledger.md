# Open Items — review: the pre-dispatch untracked-file baseline cannot be written from a worktree-isolated session (#3302)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD Task 1 minor: `realLsof` set no timeout/maxBuffer — a hung `lsof` would block `build` (raised to Important by final review) | fixed | `timeout: 10000`, `maxBuffer: MAX_BUFFER`, quiet stderr — `5a1360ef1` |
| 2 | build | SDD Task 1 minor: F2 fake-git test ran the real `lsof` (not hermetic) | fixed | `lsof: () => ''` stub added — `5a1360ef1` |
| 3 | build | SDD Task 2 minor: `step3-debate-and-refutation.md:147` still said `step3-lens-dispatch.md` "captures" the baselines | fixed | reworded to "its `build` call writes" — `5a1360ef1` |
| 4 | build | SDD parked (final-review Minor #6): the no-hand-write negative test only catches `>` redirects; a `tee`/Write phrasing would pass | observation | — |
| 5 | build | SDD parked (final-review Minor #7 / Task 1 minor): `plugin/bin/build-review-context.js:7` header comment is an unwrapped 140-char line — cosmetic | observation | — |
