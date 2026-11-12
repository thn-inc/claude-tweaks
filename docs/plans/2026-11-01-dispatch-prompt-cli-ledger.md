# Open Items — Render dispatch Task prompts from a CLI instead of hand-substituting task-prompt.md

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main 154 commits ahead of the run branch on resume (2026-11-12) — build catch-up merges it | open | |
| 2 | ops | Shape check: Task 3 and Task 4 each declare more than 5 files — proceeded under auto (tangled-task risk accepted) | open | |
| 3 | build | SDD ruling — Task 2 Step 5 live-probe gate counted as passed although its first attempt mismatched (50589 B joined vs 46299 B rendered, implementer mis-c: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | build | SDD ruling — the earlier Task 2 probe-gate ruling is withdrawn: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 5 | build | SDD ruling — G1's never-dispatched first call gets a declared '(…: skip the claim release)' parenthetical on the §5 cleanup-only call plus the matching w: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 6 | build | SDD ruling — the reviewer's ⚠ that the gate might deny the §5/§6 teardown is unfounded: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 7 | build | SDD ruling — minor 6 (task-prompt.md:97 imperative 'Substitute this whole block…' and continuation-call.md:5 'inlined verbatim with the same substitution: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 8 | build | SDD ruling — a first call that never dispatched is re-selectable on every later firing with no retry ceiling (Settle step 4's count never runs; firing-ex: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 9 | build | SDD ruling — per-Agent-call latency prefilter (bash-prefilter earlyGate skip for prompts with no marker and no run-id token) deferred to a follow-up reco: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 10 | build/skill | extends pre-tool-use-gate-exemptions: a deny gate on a non-file tool (here Agent/Task, #4589's dispatch-prompt-gate.js) is required lazily inside its own runInner branch, inside a try that allows on a load fault, so a load error in it can never disable the Bash/Edit/Write gates — the skill states no rule on gate-module loading (final review B5) | observation | — |
