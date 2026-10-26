# Open Items — Bound the shell-scanner differential recipe so a real write shape cannot outlive its run and fill the disk (#4391)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Leftover-check prose named fd `4u`, but `cat a f1 > f1` writes on fd 1 — drop the fd number (SKILL.md leftover-check paragraph) | fixed | f2e6a0aae — "shows its open output file", no fd number |
| 2 | build | Key Patterns paragraph still said "a logging `git` stub first on `PATH`" though PATH is now the stub dir alone; a stub needing a PATH tool fails | fixed | f2e6a0aae — "stub dir that is the whole `PATH`" + stub-must-not-need-PATH clause |
| 3 | build | Bounded bash verdict prose paragraph was one dense block | fixed | f2e6a0aae — split into four bullets, same content |
| 4 | build | 64 KiB output-retention path not exercised by the scratch check | fixed | scratch check.js `floodCase` (stdout + stderr flood, kept=65536, both bashes); controller re-run 22/22 PASS |
| 5 | build | SDD ruling — fix the three build-introduced prose minors in one more round rather than deferring them: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
