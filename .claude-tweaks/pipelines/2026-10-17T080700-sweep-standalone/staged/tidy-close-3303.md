## Staged: Close (GitHub) — #3303

**Finding:** [sizing] #3303 "Remove the leftover probe-guard-hooks scratch worktree and branch from #2783" — its whole deliverable was done by this sweep's tidy Step 7: worktree `.claude/worktrees/probe-guard-hooks` and branch `worktree-probe-guard-hooks` (was f6665ee7f) were removed after re-verifying the branch is an ancestor of origin/main, net-empty against its fork point, and unlocked.
**Proposed:** Close as completed (worktree and branch already removed by tidy)
**Commands:**
gh issue comment 3303 --body "Done by /claude-tweaks:sweep's tidy pass (2026-10-17): removed .claude/worktrees/probe-guard-hooks and deleted branch worktree-probe-guard-hooks (was f6665ee7f) after re-verifying it is an ancestor of origin/main and net-empty against its fork point."
gh issue close 3303 --reason completed
