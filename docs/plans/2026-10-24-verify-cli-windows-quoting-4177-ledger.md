# Open Items — Shell-neutral fixture commands in verify's cli.test.js (#4177)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | nodeCmd's arg guard allows a mid-string double backslash (cli.test.js:52-53), which /bin/sh collapses inside double quotes and cmd.exe keeps — no current fixture passes one | deferred | SDD task-review Minor; no whole-branch review this run (fast-lane single task) — triage at the resolve gate |
| 2 | build | the nodeCmd guard test's throw assertions match bare /nodeCmd/ (cli.test.js:3476-3477), not the flagged character, so they don't pin which class was refused | deferred | SDD task-review Minor; triage at the resolve gate |
| 3 | build | the #4177 scan is line-based (cli.test.js:3469) — a node -e and quote split across lines, or a doubled space, would slip past | deferred | SDD task-review Minor; triage at the resolve gate |
