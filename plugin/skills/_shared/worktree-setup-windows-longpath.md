# Worktree Setup — Windows `Filename too long` Recovery

Split out of `worktree-setup.md`'s Post-creation catch-up section (#2722) — Windows-specific
recovery detail an ordinary (non-Windows, non-failing) worktree-creation catch-up never needs to
read. Cited from that section's `Filename too long` paragraph; read this file only when a
fetch/merge during that catch-up actually fails with `Filename too long`.

**Windows: `Filename too long`.** This repo tracks paths well past 180 characters under
`.claude-tweaks/pipelines/**/spec-*/work/{n}-spec.md` (longest observed 225); with a Windows
checkout prefix these can exceed the default ~260-character `MAX_PATH`, and `core.longpaths` is
off by default in Git for Windows. A fetch/merge above that fails with `Filename too long` is a
fixable local misconfiguration, not a connectivity failure — it must **not** take the fail-open
path below. `git config --get core.longpaths`; when unset or `false`, `git config core.longpaths
true` (repo-local — linked worktrees share the main checkout's `.git/config`, so one setting
covers every worktree of this repo; `--global` is the operator's own choice, not this procedure's)
and retry the merge. This failure can leave the merge partially applied: it self-aborts with no
`MERGE_HEAD` (`git merge --abort` finds nothing to abort), and the incoming files land as
untracked additions, so a naive retry fails again with "untracked working tree files would be
overwritten." Recovery — safe **only** on a freshly created worktree with no commits or edits of
its own (`_shared/git-discipline.md`'s "never reset or discard" rule is the default this carves
out): confirm freshness (`git log --oneline origin/{integration-branch}..HEAD` prints nothing and
`git status --porcelain` shows only the untracked leftovers), then `git reset --hard HEAD` and
`git clean -f -d -- {leftover paths}`, then retry the merge.
