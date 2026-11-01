# Open Items — hooks.js: decide whether an unknown-flag refusal should exit non-zero (#4834)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of local main at run start (2a25ffc34 vs 770624963). The worktree's post-creation catch-up merged it; the main checkout's local main still trails until reconcile fast-forwards it. | open | — |
| 2 | build | SDD ruling — hooks.js entry catch turns any verb exception into exit 0, deferred to a follow-up (Defer-reason: needs-human-decision): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build/skill | hooks-js-verb-registration extends: a dispatcher-level stderr refusal that returns straight into `process.exit` writes with `fs.writeSync(2, …)` inside a try/catch (EBADF/EPIPE would otherwise reach hooks.js's entry `.catch(() => process.exit(0))`), and is pinned by an in-process `main()` test that throws on fd 2 against a read-only verb — decision 4's flush rule covers stdout only. | open | — |
