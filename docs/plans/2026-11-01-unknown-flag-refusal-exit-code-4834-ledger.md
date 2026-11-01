# Open Items — hooks.js: decide whether an unknown-flag refusal should exit non-zero (#4834)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of local main at run start (2a25ffc34 vs 770624963). The worktree's post-creation catch-up merged it; the main checkout's local main still trails until reconcile fast-forwards it. | fixed | Local main has since fast-forwarded past 2a25ffc34 (now 51355951f); `git merge-base --is-ancestor 2a25ffc34 main` exits 0 |
| 2 | build | SDD ruling — hooks.js entry catch turns any verb exception into exit 0, deferred to a follow-up (Defer-reason: needs-human-decision): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build/skill | hooks-js-verb-registration extends: a dispatcher-level stderr refusal that returns straight into `process.exit` writes with `fs.writeSync(2, …)` inside a try/catch (EBADF/EPIPE would otherwise reach hooks.js's entry `.catch(() => process.exit(0))`), and is pinned by an in-process `main()` test that throws on fd 2 against a read-only verb — decision 4's flush rule covers stdout only. | fixed | Wrap-up skill curation appended it to decision 6 (names the pinning test), commit b78b6e919 |
| 4 | review | Ownability (low, lens 3g, confirmed): the writeSync try/catch in the unknown-flag refusal (plugin/bin/hooks.js) had no comment naming the entry `.catch(() => process.exit(0))` trap it guards or the test that pins it | fixed | Comment added, commit 40fcd9cf9; scoped re-verify 7243/7243 pass |
| 5 | wrap-up | Reflect (convention) — in-process main() tests must drive a read-only verb or stub plus chdir: edit hooks-js-verb-registration decision 5 at the Review Console (staged/reflect-1.md) | open | — |
| 6 | wrap-up | Reflect (observation) — spec rationale and AC grep carried unprobed claims, caught at plan time: decline proposed (staged/reflect-2.md) | open | — |
| 7 | wrap-up | Reflect (observation) — context-cap handoff after build worked as designed: decline proposed (staged/reflect-3.md) | open | — |
