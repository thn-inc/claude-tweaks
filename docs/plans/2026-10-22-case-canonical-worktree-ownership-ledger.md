# Open Items — #3836: classifyOwnership and findRunsByWorktreePath case-canonical worktree comparison

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task-review minor carried forward: isOtherWorktreeBound (resolveRun strict attribution) still compared JS-form paths, so the new skill-row and ALLOWLIST prose overclaimed | fixed | Routed into fix round 1 under the deferral gate's fix-now test (not left deferred); fixed in 600eaed10 — isOtherWorktreeBound compares both sides through canonicalRealpath, with a resolveRun strictAttribution regression test; scoped re-review ADDRESSED |
| 2 | build | SDD ruling — Task 1 ran only the plan's focused suites, not full npm test (Common Step 5 runs it centrally): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — implementer dispatched on haiku (Fast) per /build's size:low profile override of SDD's mid-tier floor: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — the isOtherWorktreeBound minor entered fix round 1 despite SDD's minors-never-loop rule (deferral-gate fix-now): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
