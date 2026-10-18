# Open Items — build-review-context.js: the shared review bundle has no size bound (#3020)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD Ruling: big-modified.txt fixture built from many short lines so AC1.2's "full content absent from context.md" is asserted over the whole bundle | observation | Pre-flight ruling (SDD ledger) |
| 2 | build | SDD Ruling: always-stub matches (lockfiles, .jsonl) are diff-elided for every change type, modified included; over-cap elision stays added/deleted-only (final-review Important #1; reverses plan Global Constraint) | observation | Implemented in 11ed05105; premise-reversed line logged in decisions.md |
| 3 | build | SDD Ruling: diff/--name-only git calls made git-config independent (-c core.quotePath=false, --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/) (final-review Important #2) | observation | Implemented in 11ed05105 |
| 4 | build | SDD Ruling: final-review Minors #3-#6 and the 64 KB prose pin folded into the single fix wave | observation | Implemented in 11ed05105 |
| 5 | build | Diff elision measures chunk bytes, section stub measures content bytes — an added file of exactly the cap is diff-elided and listed but its section inlined | accepted | By design: listing names elided hunks as well as stubbed sections, and the prose (step3-lens-dispatch.md:72) says so |
| 6 | build | Added/deleted files with git-quoted (non-ASCII) paths were never diff-elided | fixed | 11ed05105 (core.quotePath=false; café.txt fixture test) |
| 7 | build | No dedicated test for binary added chunks or rename chunks | accepted | Final reviewer probed binary, rename, mode-only, empty .jsonl and mnemonicPrefix shapes against the branch code — all correct; rename/quoted kept whole by design |
| 8 | build | build-review-context.js header comment line 7 exceeds neighbouring width | accepted | Cosmetic; rewrap when the file is next touched |
| 9 | build | step3-lens-dispatch.md:72 "still sees that file's change either way" read as covering elided hunks | fixed | 11ed05105 (F5) |
| 10 | build | Section stub said "its change is in the diff above" even when the file's hunk was elided / file deleted | fixed | 11ed05105 (F4 whereToLook branches) |
| 11 | build | Prose hardcoded "64 KB" with no test tying it to PER_FILE_CAP_BYTES | fixed | 11ed05105 (prose.test.js pin) |
| 12 | build | docs/plugin-structure.md:198 names oversizeSections but not the cap/stub/elision semantics | accepted | :198 is a CLI field list; the semantics now live on docs/plugin-structure.md:45 (11ed05105) |
| 13 | build | Deleted over-cap non-lockfile file: chunk elided (deleted-file-mode line removed) and section empty with no stub, so the lens bundle carries no in-bundle pointer to `git show {base}:{path}` (SDD final parked — real, deferred: spec AC4 pins deleted files to emptySections only) | open | — |
| 14 | build | `git show {base}:{path}` stub hint reads the base tip rather than the merge-base, and does not escape paths with spaces/backticks | accepted | Pointer-only text; final re-review judged it acceptable/cosmetic |
