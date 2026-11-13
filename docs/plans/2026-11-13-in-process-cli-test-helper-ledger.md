# Open Items — Add the in-process CLI test helper and entry contract, and convert resolve-policy.js (#5374)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — count-node-procs: the node --test runner is never a test-file process, and a process belongs to the outermost test file in its chain: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — the CLAUDE_PLUGIN_ROOT test in tests/resolve-policy-cli.test.js stays a real-process test, so the two converted files start 4 resolve-policy.js processes (limit 6): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — the run-cli fail-closed key list stays runner, gh and spawn, a converting record adds its own process-starting key, and git-only seams stay real: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — the process-wide gh and git timeout knobs stay ambient reads and are named as an exception in the CLI entry contract, not threaded through the injected env: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
