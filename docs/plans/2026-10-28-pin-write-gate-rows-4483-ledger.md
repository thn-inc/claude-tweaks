# Open Items — Pin the untested write-gate rows and retire the non-discriminating flat-pass test

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | cp's no-`-t` operand loop reads a trailing option value as the destination: `cp a /main/f.js --suffix .bak` resolves /r/.bak while GNU cp writes /main/f.js (write-gate under-report, `plugin/bin/lib/hooks/git-command.js`) | deferred | Defer-reason: pre-existing-outside-diff — git-command.js is not in this build's diff (test-only record); already tracked by open #4449 (Deliverable 1: skip -S/--suffix values in the cp/mv operand loop) |
| 2 | build | SDD ruling — "(before #4210 it did)" parenthetical at test line 894 kept as a released-change comparison, not erased-history narration: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
