# Open Items — Delete a closed record's plan ref in reconcile

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence: origin/main was 4 commits ahead of local HEAD at run start (reason-not-auto: requires-judgment) | fixed | Post-creation catch-up merged origin/main into the worktree branch at 0995ccee44 before any build commit |
| 2 | build | SDD ruling — origin-unresolvable test fixture lists one plan ref: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — dispatch-order test asserts on the last plan-refs include: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — gateOriginRepo over parseRepo per gh-host-seam suite: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — delete-failed detail from the !/error:/fatal: line: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — missing origin reported as no-origin: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — local-merge fixtures pinned to no-origin kept: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build | SDD ruling — failure hint uses plugin hooks.js, no --dry-run: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 9 | build/skill | gh-api-module-pattern extends: a push to the plugin's own bookkeeping ref namespace (plan-store write, plan-refs delete) passes --no-verify, so a consumer pre-push hook never gates it and GIT_TIMEOUT_MS suffices — the skill's GIT_PUSH_TIMEOUT_MS rule covers only hook-running pushes | observation | — |
