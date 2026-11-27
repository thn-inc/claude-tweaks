# Open Items — Let the design skill's readers use the top model tier through one named exception in the model resolver

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence: origin/main was 5 commits ahead of local main at /flow Step 2.5 (reason-not-auto: requires-judgment) | fixed | Worktree post-creation catch-up merged origin/main in commit 5e9c313; the build branch starts from the current integration tip |
| 2 | build | SDD ruling — design-reader exception rules split into _shared/frontier-exception.md, one slots row in subagent-dispatch-core.md (review-dispatch bundle headroom): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | Final review recommendation: the design folder's frontier-exception-tally.log and .frontier-exception-tally.lock should be gitignored or deliberately committed by the design skill | deferred | Defer-reason: blocked-dependency — origin: final whole-branch review; files: plugin/bin/lib/model-profiles/exception-tally.js (tally/lock names), the design folder #6352 creates; trigger: when #6352 builds /design and decides whether the tally travels with the committed folder; carried by #6352 |
