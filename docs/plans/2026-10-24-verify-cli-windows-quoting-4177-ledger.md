# Open Items — Shell-neutral fixture commands in verify's cli.test.js (#4177)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | nodeCmd's arg guard allows a mid-string double backslash (cli.test.js:52-53), which /bin/sh collapses inside double quotes and cmd.exe keeps — no current fixture passes one | deferred | SDD task-review Minor; no whole-branch review this run (fast-lane single task) — triage at the resolve gate |
| 2 | build | the nodeCmd guard test's throw assertions match bare /nodeCmd/ (cli.test.js:3476-3477), not the flagged character, so they don't pin which class was refused | deferred | SDD task-review Minor; triage at the resolve gate |
| 3 | build | the #4177 scan is line-based (cli.test.js:3469) — a node -e and quote split across lines, or a doubled space, would slip past | deferred | SDD task-review Minor; triage at the resolve gate |
| 4 | wrap-up | reflect (light, Near-misses): the spec-time site grep counted 12 single-quoted node -e sites, the real count was 14 — two spell the quote as an escaped \' inside a JS single-quoted string | accepted | Don't capture: an existing memory rule already covers it (grep every token and its escaped spelling). The build's scan regex caught both spellings, at no rework cost |
| 5 | wrap-up | disposes row 1: the wrap-up resolve gate's fix-now test applied (a one-line change in a file this diff touches) | fixed | nodeCmd's argument guard now also refuses a doubled backslash; the AC4 test pins it with `C:\a\\b`, and went red with the guard reverted |
| 6 | wrap-up | disposes row 2: fix-now, same file | fixed | the AC4 guard test asserts each refusal names the flagged character (script, argument, trailing backslash), not just a bare /nodeCmd/ match |
| 7 | wrap-up | disposes row 3: fix-now, same file | fixed | the AC1/AC3 scan matches the whole file with /node\s+-e\s+\\?'/ and reports line numbers; a probe split across two lines with a doubled space went red (line 3488), then was removed |
