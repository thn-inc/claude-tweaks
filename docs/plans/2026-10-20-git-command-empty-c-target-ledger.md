# Open Items — git-command: empty -C and omitted -C resolve to different targets on Windows

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task review minor: skipGlobalFlags empty -C branch (git-command.js) is a comment-only empty block; an explicit early `i += 2; continue;` would read clearer | deferred | — |
| 2 | build | SDD task review minor: no committed test catches `pathImpl` silently unused on the non-empty -C branches of skipGlobalFlags (AC1.2 is vacuous on posix if pathImpl were ignored; the go-red control covered it once) | deferred | — |
