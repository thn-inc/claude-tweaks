# Tidy staged item — prune 23 merged remote branches

**Proposed:** Delete 23 remote-tracking branches on origin that are already merged into origin/main (residue.js kind: branch; reconcile remote-prune skipped them as not-cherry-equivalent / no-merged-pr).

**Why:** outward-facing pushed deletion — Stage at every tier (step-6-auto.md, Merged remote-branch deletion row).

**Invariant:** at approval time each branch must still be listed by `git branch -r --merged origin/main` and have no OPEN PR with that head; skip any branch failing either check.

```bash
git push origin --delete worktree-dispatch-record-1906
git push origin --delete worktree-record-1794-bundle
git push origin --delete worktree-record-1876
git push origin --delete worktree-record-1877
git push origin --delete worktree-record-1900
git push origin --delete worktree-record-1903
git push origin --delete worktree-record-1919
git push origin --delete worktree-record-1962
git push origin --delete worktree-record-1963
git push origin --delete worktree-record-1964
git push origin --delete worktree-record-1965
git push origin --delete worktree-record-1966
git push origin --delete worktree-record-1970
git push origin --delete worktree-record-1971
git push origin --delete worktree-record-1973
git push origin --delete worktree-record-2006
git push origin --delete worktree-record-2009
git push origin --delete worktree-record-2014
git push origin --delete worktree-record-2016
git push origin --delete worktree-record-2017
git push origin --delete worktree-record-2018
git push origin --delete worktree-record-2020
git push origin --delete worktree-record-2023
```
