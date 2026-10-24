# Open Items — reconcile/console-execute.js loads the wrap-up pack on every SessionStart reconcile to reach one header parser (#4060)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | `plugin/bin/lib/console/sdd-ruling.js`'s moved comment says "`stagedItems` here" though `stagedItems` lives in `console/resolve.js` (SDD task-review minor) | fixed | Commit 1957fb96c (Common Step 3 simplify) — comment now names `console/resolve.js`. |
| 2 | build | The fresh-process pack-load test in `tests/console-execute.test.js` has no positive control showing the `require.cache` filter finds `pack.js` after loading `console/resolve` (SDD task-review minor; discrimination proven by the reviewer's revert run in a scratch worktree) | fixed | Review Step 3 fix-now — positive control added to the same test (same filter finds pack.js after loading console/resolve.js); revert check red with the old require restored, green with the leaf. |
| 3 | review | Stale prose pointers to `console/resolve.js`'s `sddRulingDeferralReason` (wrap-up/pack.js comment, docs/skill-graph.md, the #3880 journey doc) after the function moved to the leaf | fixed | Review Step 3 fix-now — repointed to `console/sdd-ruling.js`. |
