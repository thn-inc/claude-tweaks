# Open Items — Teardown gate's assigned-run deny can miss a mis-cased worktree path on a case-insensitive volume

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — classifyOwnership (context.js:525) and findRunsByWorktreePath still use worktreeMatches's 3-arg JS-form default (case-sensitive on a case-insensitive volume); out of #3769 AC, route to one follow-up record: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | findRunsByWorktreePath (reflect Friction Lens ad-hoc fallback) still compares with JS fs.realpathSync, so a mis-cased worktree path misses its ad-hoc run dirs | deferred | origin: SDD Task 1 review + final review triage; files: plugin/bin/lib/hooks/context.js findRunsByWorktreePath; trigger: bundled into item 1's follow-up proposal (staged/sdd-ruling-1.md) |
| 3 | build | path-guard-conformance.test.js context.js allowlist reason cited stale existsSync line numbers (65, 557) | fixed | 119b3705d (now 44, 637) |
| 4 | build | shadowPipelineRunDir still resolves statSync(runDirCandidate) and wtDetect.repoInfo on the real fs, not via fsImpl | accepted | test-only seam: run()'s deps is never set in production (bin/hooks.js passes one argument), so there is no production effect; final whole-branch review triaged it not merge-blocking |
