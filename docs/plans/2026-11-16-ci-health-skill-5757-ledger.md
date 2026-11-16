# Open Items — Add a ci-health skill that audits where CI time goes and files findings

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 5 commits ahead of local main; local main also carried 10 unpushed [reconcile] archive commits that ride along into this worktree and its PR | observation | Continued under auto; the worktree merged origin/main at creation. The 10 reconcile commits predate this record's work. |
| 2 | build | SDD ruling — forge CLI and host-pin code lives in source.js, never ci-audit.js: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — repeated-work breach carries a step field and a null workflow: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — Task 7 contract differences accepted (fingerprint step, payload signature, no Verified-as-of stamp): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — extra code sites for the by:ci-health origin (grouping.js, record-graph palette): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — agnostic scan allows _shared contract path citations and scans comments: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — health-sweep count words updated in CLAUDE.md and shared contracts: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build/skill | [skill: NEW - health-sweep-addition] Adding a sixth health sweep touched ~35 files and each task found one more roster site only when a suite or reviewer failed (timing-nested-parent-roster allowlist, docs/getting-started.md, skill-graph rows, "four health sweeps" consumer lists in _shared/health-*.md, init bootstrap step 17, CLAUDE.md counts, strip-comments callers twin); a project skill listing every site a new health sweep must land in would have made it one pass. | observation | — |
