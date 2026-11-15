# Open Items — Give eight small CLIs an injectable entry and run their tests in-process

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 7 may shadow run with a local binding to keep the pinned probeForge shape: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — Task 2 forwards the policy-root cwd into resolvePolicyConfig: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — Injected envs carry PATH + SystemRoot/USERPROFILE; raw path args keep empty-string behaviour: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — file-lock.js CLAUDE_TWEAKS_LOCK_WAIT_MS stays a process.env timeout knob: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — Task 9 measurement runs after the final-review fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | SDD ruling — A relative path under a deleted working directory now fails clearly: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 7 | build | declined-learning deleted-cwd lookup test (tests/bin-lib/declined-learning-cli.test.js:174) reads the real main-checkout store through anchorRoot(undefined)'s process.cwd() — read-only with a unique description so the null assertion holds; only the real-process probe covers the anchorRoot catch itself. | observation | — |
| 8 | build | the new cwd fallbacks (blast-radius.js:59, storeCwd, childCwd) catch any throw, not only ENOENT; process.cwd() only throws for an unreadable cwd, so harmless today. | observation | — |
