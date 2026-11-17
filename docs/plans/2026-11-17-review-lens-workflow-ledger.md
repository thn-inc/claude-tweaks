# Open Items — Run the review lens fan-out as a plugin workflow, behind a policy key

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of local HEAD at run start; continued under auto | fixed | Post-creation catch-up merged origin/main (a71ac54175) into the worktree branch before materialize |
| 2 | build | SDD ruling — T1 key ships without the Not-yet-used marker: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — T2 m3 (loader evals meta with new Function, accepts non-literal meta) not fixed in the helper: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — T3 m2 (section cites docs/reference/workflow-tool-probe.md outside plugin/) kept: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — T4 gap fill: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — Task path has no categorise-reproduction --run exit-3 handling (out of #5599 scope): ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — q1 not fixed in this build: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build/skill | [skill: NEW - plugin-workflow-script] First plugin/workflows/ script: pure-literal meta, args validated before any agent(), each agent() wrapped on its own, tested by tests/helpers/workflow-script.js's stub-globals loader plus a banned-token source scan — no project skill covers authoring or testing one. | open | — |
| 9 | ops | AC13 run 1 (one lens, two reviewers): headless claude -p --plugin-dir <worktree>/plugin --model haiku, dontAsk, --allowedTools Workflow(claude-tweaks:review-lens-fanout) | fixed | init skills lists claude-tweaks:review-lens-fanout; run wf_77011d23-d00 status completed, started: true, 2 reviewers, 0 failed, run file 5,575 bytes; quoted in PR #5819 |
| 10 | ops | AC13 run 2 (seven lenses x 2, 8,773-byte briefs, args 62,690 bytes, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0) | fixed | run wf_558c969f-87b status completed, started: true, 14 reviewers, 0 failed, run file 79,685 bytes; quoted in PR #5819 |
