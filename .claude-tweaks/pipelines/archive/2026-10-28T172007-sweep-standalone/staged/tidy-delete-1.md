# Tidy — staged delete: 3 orphan remote-tracking refs

**Action:** Delete (judgment) — local ref deletion, no push
**Reversibility:** high (each ref is an ancestor of origin/main; recreate with `git update-ref <ref> <sha>`)

## Finding

Three remote-tracking refs belong to remotes that are no longer configured (`git remote` lists only `origin`). Each points at a commit already contained in origin/main (`git merge-base --is-ancestor` exit 0, re-verified at staging time):

| Ref | SHA |
|---|---|
| refs/remotes/local-check/main | 34b6b03238a9b57c4a549a100bee37cc5dd73bc9 |
| refs/remotes/local-check/main2 | b0695c0a83bb85291b1729b22bbc00667f3d44fd |
| refs/remotes/local/main-check | 37e8e58badf93864ecba9d51c147ea322dcc4efb |

`refs/remotes/pr/*` (8 refs) were not merge-checked and are out of scope.

## Why staged, not auto-applied

The moderate tier would auto-apply this, but the worktree-always PreToolUse gate denies `git update-ref` in the main checkout (refused 2026-10-28T18:3x during this sweep). Run it from any linked worktree; refs are shared across worktrees.

## Mutation on approval

1. Re-verify each ref still resolves to the SHA above and is still an ancestor of origin/main.
2. `git update-ref -d <ref> <sha>` for each (old-value-guarded, so a moved ref is not deleted).

## Decision-log reference

STAGED — Step 6: delete 3 orphan merged remote-tracking refs. Stage path: staged/tidy-delete-1.md.
