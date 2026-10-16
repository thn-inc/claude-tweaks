---
name: merge-shape-landed-proof
description: Use when writing or reviewing a check that decides whether a branch's work already landed on the integration branch, before something destructive or state-changing acts on that answer. Examples are discarding a worktree, deleting a local or remote branch, archiving a run, or flagging a record as shipped but unclosed. The proof has to match the merge shape the integration model produces. Keywords - landed, merged, is-ancestor, merge-base, squash, merge-tree, cherry, patch-id, pr-first, local-merge, discard_changes, branch delete, squash-provenance.
---

# Merge-Shape Landed Proof: prove "already merged" the way it was merged

"Has this branch's work landed?" has no single proof that works for every merge shape. Each
proof holds for some shapes and silently fails for others. A check that uses the wrong proof
fails in one of two ways:

- It never passes, so cleanup that is actually safe stalls forever.
- It passes when it shouldn't, so unmerged work is discarded.

`_shared/integration-model.md` decides which shape applies. Read its resolution once and never
re-derive it ad hoc.

## Pick the proof by shape

| Merge shape | Produced by | Proof that holds | Proofs that silently fail here |
|---|---|---|---|
| `--no-ff` or fast-forward | `local-merge` (`_shared/local-merge-auto-finish.md`, `dispatch/settle-and-merge.md`, `_shared/issue-claims.md` Close-via-merge) | `git merge-base --is-ancestor HEAD origin/{integration-branch}` | SHA equality, which only holds after a fast-forward |
| squash | `pr-first` (`_shared/pr-first-merge.md` Step 3, `gh pr merge --squash`) | content proof against the PR's own `mergeCommit` (see below) | ancestry, because a squash commit's parents never include HEAD. SHA equality. `git cherry` / patch-id on a multi-commit branch. A plain `git diff HEAD {merge-commit}`, which reports a false difference whenever another PR landed between this branch's fork point and its merge |

A branch that was discarded without ever merging (no recorded PR) is a third case. It keeps
`[IL-45]`'s content-diff fallback. Never route it through either proof above.

## Reuse before writing a new one

- **Node:** `plugin/bin/lib/reconcile/squash-provenance.js` already implements a three-condition
  squash proof, used by `prune-remote.js` and `archive-branches.js`. It returns a boolean and
  treats every git failure as false, so it fails safe. Call it rather than re-deriving it.
- **Skill prose:** `wrap-up/cleanup-procedures-execution.md` Section C step 4 (#3088) carries
  the run-anywhere form for an agent: `git merge-tree --write-tree {merge-commit} HEAD` compared
  to `git rev-parse {merge-commit}^{tree}`.
- The two forms answer different questions, so name which one your call site needs:
  - `squash-provenance.js` replays the branch onto `{oid}^`. It asks: does the branch tip
    reproduce exactly this squash?
  - Section C merges HEAD into the merge commit itself. It asks: does HEAD carry anything the
    merge commit lacks?
  - Discarding a worktree needs the second question. Deleting a branch based on decision
    tables needs the first.

## Failure discipline (applies to every shape)

- Make the failed lookup a distinct signal. A `gh pr view` failure (auth, network, rate limit)
  is not the same as a successful call that returns no `mergeCommit`. See `parse-signal-discipline`.
- Every failure resolves to "unproven", never to "proven". An unproven result means stop and
  surface the problem. It never means override.
- Run `git fetch origin {integration-branch}` before trusting a `mergeCommit` oid to resolve
  locally. Teardown can run from a resumed or cross-session context that never fetched.
- `git merge-tree --write-tree` needs git 2.38 or later. On older git it fails, and the
  failure must land in the unproven branch.

## Recurrences this skill exists to stop

- #2251 switched `pr-first` to `--squash`. After that, the `git cherry` checks read every
  squash-merged multi-commit branch as unmerged.
- #2252 review F1: "the mergeCommit oid is on history" alone accepted a branch that gained a
  commit after its squash merge. A tree-equality condition had to be added.
- #3088: Section C told agents an ancestry check "holds for squash", which was false by
  construction. The fix replaced it with the containment proof above.

When you add a new "is it landed?" check, or review one, run the table first. Also grep
`plugin/bin/lib/` for `merge-base --is-ancestor` call sites that run under `pr-first` and have
no squash branch. Each one is a candidate for this same bug.
