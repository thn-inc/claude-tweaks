# Open Items — Give test fixtures a one-process repo init and remove the per-fixture git config identity calls

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — a sweep task's "grep printing nothing" check excludes the behaviour-under-test sites it reports for the allowlist: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — runnerChildEnv passes an inherited GIT_TEMPLATE_DIR through when templateDir is null (faithful extraction beats the brief's 'no key' wording): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — the 12 kept --initial-branch=main inits stay as written: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — fix writeIdentity to write git's own bytes (quote only when git would: leading/trailing space, ';' or '#'; escape backslash, quote, newline, tab) and sweep the statusline site, before Tasks 5-6: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — keep every sibling-owned allowlist entry, #5770's included, even with no match today: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | SDD ruling — keep the sibling-owned files untouched and their allowlist entries, prune-remote.test.js's two identity pairs included, despite the owning records having merged: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 7 | build | SDD ruling — ledger minors the final reviewer rated can-defer with no effect today: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 8 | build | SDD ruling — move the AC2.1 spawn test to tests/git-template-sample-hooks.test.js rather than loosen count-node-procs AC10.1: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
