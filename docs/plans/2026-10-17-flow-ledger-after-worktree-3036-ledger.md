# Open Items — #3036: flow Step 1.8 creates the open-items ledger before the run's worktree exists

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check: origin/main was 38 commits ahead of local main at /flow Step 2.5 | fixed | Worktree branch caught up with origin/main at creation (post-creation catch-up, HEAD 12bd85599) |
| 2 | ops | Ledger created after worktree creation rather than at /flow Step 1.8 — the installed 6.140.0 Step 1.8 cannot write docs/plans/ from the main checkout under worktree-always (the defect this record fixes) | observation | Deliberate per this record's own Deliverable 1 ordering; logged to decisions.md |
| 3 | build | Spec deviation: Step 1.8 creates the ledger for `current-branch` runs only — the spec's Deliverable 1 also kept it for already-isolated sessions, but an untracked ledger written there makes the Adopt-or-create clean-tree check (`git status --porcelain`, `_shared/worktree-setup.md`) abandon the adopted worktree | observation | Ruled for the spec's intent over its wording at the final whole-branch review (469c188a5); adopted worktrees get the ledger at `build/worktree-setup.md` Step 4.6 / multi-spec Shared worktree step 1, still before the first build task |
