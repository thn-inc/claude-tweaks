# Open Items — Cut redundant local full-suite runs in pipelines — affected-set per task, no worktree baseline run

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence: origin/main was 946 commits ahead of the main checkout local main (reconcile mirror-ff refused: dirty main checkout); worktree caught up by post-creation merge (be11935 to 502b532) | observation | Informational — worktree is current with origin/main; main checkout's local main remains stale until its dirty files are resolved (reason-not-auto: requires-human-judgment) |
| 2 | build | SDD ruling — Task 1 spells the per-task verify.js call with ${CLAUDE_PLUGIN_ROOT}: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — Task 1 review minors: batched fact widened in Task 2, foreground suite re-run: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — Task 2 review minors: slice guard added in Task 3, single-pattern proof kept: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — Task 3 review minors: frozen absence control kept, bare npm test regex widened: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — Task 4 review minors fixed in the final fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — worktree-setup step 3 rationale left as is (bundle near the Read rail): ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build | SDD ruling — fix-wave re-review residuals, no change: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 9 | review/hindsight | Skill-worthy pattern: overriding a step of a third-party skill (superpowers) needs an imperative in the invocation (tell it to skip X) plus an upstream-drift pin of the overridden line — a descriptive clause about what the skill does never reaches it; #5117's review caught exactly this in worktree-setup.md. [skill: upstream-drift] | observation | Hindsight Step 4: approach, structure, consolidation and convention evaluations found nothing beyond the review fix wave; this pattern is for wrap-up's Skills curation |
