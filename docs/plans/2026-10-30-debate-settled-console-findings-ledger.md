# Open Items — Review Console leaves debate-settled findings keep-staged (#4563)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence: origin/main was 16 commits ahead of local main; reconcile could not fast-forward the main checkout because a sibling session's untracked `.claude-tweaks/pipelines/2026-10-28T172007-sweep-standalone/` dirties it (reason-not-auto: requires-judgment — the run dir belongs to another session) | acknowledged | This worktree caught up via the post-creation merge (519af9a72); the main-checkout mirror stays behind until that run dir clears, tracked by #4462 |
| 2 | build | Run 2026-10-27T184830-spec-4481's console residue is not the debate gap the spec cites: it is an aggregate reproduction STAGED line (`lens "3a" 10 findings not reproduced (A: journey:89 …, git-command.js:2253 …)`) naming ten findings with shortened locations, so no tiebreak verdict's full-path key ever matches it and it stays keep-staged | open | Defer-reason: tangential — a different producer shape (step 3 aggregate reproduction line) outside #4563's two settlement routes; to be filed as its own record |
