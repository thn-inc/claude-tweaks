# Open Items — friction-events: an ad-hoc EnterWorktree session's guard refusals are never logged (#2783)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 3 commits ahead of local HEAD at run start (c223eca06); continued under auto, worktree caught up post-creation | open | |
| 2 | ops | Open PR #3240 (#2989, claimed by another run) also edits `plugin/bin/friction-events.js` — expect a merge conflict with whichever lands second | open | |
| 3 | ops | Remove the scratch probe worktree `.claude/worktrees/probe-guard-hooks` (+ its branch) created by the empirical hook probe — must run from the main checkout (this session's guard refuses git ops on another worktree) | open | |
