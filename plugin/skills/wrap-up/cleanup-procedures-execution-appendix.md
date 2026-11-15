# Wrap-Up Cleanup Procedures — reference appendix (#2546)

Rare-branch and historical-rationale content split out of `cleanup-procedures-execution.md`'s
operative head, read only when the head's own citation points here. Nothing in this file runs on
the common-case path — a run that never hits the conditions named at each citation never needs
this file at all.

## Step 2: Why a dedicated commit, not the merge artifact

`/superpowers:finishing-a-development-branch`'s own git mechanics give the closing keyword no
reliable home otherwise. Its "Merge locally" option runs a bare `git merge <feature-branch>` with
no `--no-ff` — git fast-forwards silently whenever possible, producing **no merge commit at all**
to carry a message into. Its "Push and Create PR" option pushes, then creates the PR "with the
forge's tooling — its CLI if one is available" — for a GitHub remote, that's `gh pr create` — but
nothing guarantees the resulting PR body carries a closing keyword. Stamping the feature branch
itself sidesteps both: the keyword travels with the branch regardless of which of the four options
gets chosen (fast-forward merge, non-ff merge, push+PR — even one the user creates manually
afterward — or keep-as-is), because GitHub scans every commit that reaches the default branch, not
just a merge commit or PR body. See "Close-via-merge" in `_shared/issue-claims.md` for the full
contract, including the multi-terminal parallel path (`flow/worktree-merge.md`), which performs
its own merge directly with `--no-ff` and does not need this carrier commit.

## Step 4: Unverified caveat on the `reconcile` remedy

A session's own *currently-standing* worktree may still carry the same live lock named in the
head's step 4 regardless of invocation method; if `reconcile` skips it for any other reason after
a genuine merge, that lock is the likely cause, and a future session's `SessionStart` background
pass remains the fallback.
