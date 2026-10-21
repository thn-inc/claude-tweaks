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

## Landed is not closed

A merged PR proves the branch's work landed. It does not prove the PR closes any one record the
run claimed: a multi-record run's PR can merge with only some of its records shipped. A check
that releases a claim, drops `bot:in-progress`, or reports a record shipped needs closing
evidence for that record, not merge evidence.

- **Two signals, in order.**
  1. The PR's `closingIssuesReferences`, matched on the issue number and on `owner/name`
     compared case-insensitively. A reference into another repo never counts.
  2. A line-anchored closing keyword `#N` in the merge commit's message (the squash body GitHub
     reads). Fetch the message only when the references are present, don't already name the
     issue, and `mergeCommit.oid` exists.
- **Three-valued verdict.** `true` when either signal names the issue. `false` when the
  references array is present and neither signal names it. `undefined` when the array is
  absent: unknown, never "closes" and never "does not close", and the commit message is not
  consulted. A failed or empty commit-message fetch leaves the verdict on the references alone.
- **Fail closed.** Only `true` releases on the PR's evidence. `false` and `undefined` keep the
  claim and fall back to the issue's own state, since a closed issue is still release evidence.
  Each keeps under its own skip reason (`pr-merged-not-closing`, `pr-merged-closing-unknown`),
  so a missing answer stays distinct from a negative one, as the failure discipline above
  requires.
- **Reuse.** `prClosesIssue(prState, issueNumber, repoSlug, mergeCommitMessage)` in
  `plugin/bin/lib/reconcile/release-merged.js` is pure. Call it rather than re-deriving it. The
  PR read must request `closingIssuesReferences`, as `plugin/bin/lib/reconcile/pr-state.js`'s
  `PR_LIST_ARGS` and `PR_VIEW_JSON_FIELDS` do. A new keyword matcher takes its keyword set from
  `CLOSING_KEYWORD_ALTERNATION` in `plugin/bin/lib/issue-branch-tracking.js` and never retypes
  it. Only the grammar around the set may differ: `prClosesIssue` anchors at line start and
  uses `[ \t]`, not `\s`, so `Fixes` and `#N` on separate lines never match.
- **Recurrence.** #3412: PR #3348 was squash-merged while its run was still building #3311,
  with the body edited from `Fixes #3311` to `Refs #3311`. One second later the reconciler
  released #3311's claim on `merged: reconciled from PR #3348` and removed `bot:in-progress`,
  leaving an open record mid-build unclaimed.
- **Run archival uses the same ladder (#3503).** `plugin/bin/lib/reconcile/archive-merged.js`
  archives a run on merged-PR evidence only when the PR closes every record the run claims
  (`decideArchiveCore`'s `recordCheck`, via `prClosesIssue`). `false` skips as `merged-partial`
  and `undefined` as `closing-issues-unknown`. A run can legitimately wait on a later PR, so
  `settleMergedPartial` adds two rungs a claim release does not need: a record whose own issue
  is CLOSED counts as satisfied (a failed probe keeps it unclosed), and an empty references array
  (GitHub links no keyword into a non-default base) trusts only the manifest's pending/running
  specs. The `status: clean` sweep is exempt, and `work-backend: local-files` turns the check off.

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

That grep also returns call sites asking the reverse question: did the integration branch get
merged *into* this branch? Rule those out by direction before filing. `mergeNarrowing` in
`plugin/bin/lib/verify/changed-files.js` (#3072) is one. It asks whether a merge commit's
non-first parent is an ancestor of the integration ref. A branch takes in its integration branch
with a real merge commit even under `pr-first`, so squash never applies there. Every failed read
returns `null`, so the fallback over-verifies rather than discarding anything. The bug this
skill stops lives only in checks whose ancestor argument is the branch's own HEAD or tip.

## Offline readers prove landing, never non-landing

The squash proof needs the PR's `mergeCommit`, and only a forge read supplies it. A reader that
must stay network-free, such as the SessionStart banner or any other hook, is left with ancestry
and `git cherry`. Under `pr-first` those answer in one direction only:

- `ancestor`, or a `git cherry` whose every line starts with `-`, proves the work landed.
- An unmatched `git cherry` commit does not prove it didn't. A squash-merged multi-commit branch
  produces exactly that output.

So split the question by caller:

- **Offline is advisory only.** An offline "not landed" may offer an action, such as a banner
  line naming a command, but never takes one. Say at the call site that a squash-merged branch
  can still read as unmerged there, and name the online check that refuses it.
- **Online gates the action path.** The step that acts reads the PR's state first
  (`resolvePrStateByNumber` in `plugin/bin/lib/reconcile/pr-state.js`). `MERGED` means landed.
  `OPEN` means not landed, even when the offline evidence is indeterminate. Only then consult the
  offline evidence.
- **A degraded online check changes the instruction, not only the detail text.** When the PR
  read fails (no `gh`, a network error, a throw), the verdict falls back to offline evidence,
  which cannot rule out a squash merge. Prose that would proceed on that verdict must branch on
  the degrade: confirm the PR is unmerged by another read (the GitHub MCP `pull_request_read`),
  and stop when it cannot be confirmed. A pass verdict that carries "online check unavailable"
  only in its detail string loses the failure discipline's "unproven means stop".

**Reuse.** `checkBranchLanded` in `plugin/bin/lib/hooks/run-integrity.js` returns the offline
evidence without `checkRunIntegrity`'s wrap-up event gate, which every multi-spec parent run
trips. It returns `true` when merge is proven, `false` when an unmatched commit was found, and
`null` when it could not tell. Its header comment calls `false` "definitively unmerged", but under
`pr-first` read it as "unmatched commit found", not "unmerged". `checkPassReentry` in
`plugin/bin/lib/flow/consolidated-pass.js` (#3497) is the shipped instance of the split.
SessionStart calls it without `online`, and `flow/multispec-review-console.md`'s re-entry step
calls it with `online: true` through `hooks.js check-pass-reentry --online` (#3553).

**Recurrence.** #3497's review: the re-entry step first proceeded on an `eligible` verdict whose
online PR check had degraded, with the degrade visible only in `detail`. The fix made an
unconfirmable PR state a stop.

## When "landed" picks the cautious action

The rules above assume the risky action follows a *landed* verdict. Some checks run the other
way: "landed" picks the cautious, non-destructive action, and "not landed" keeps the behavior
that existed before the check. `_shared/worktree-setup.md`'s merged-branch precondition (#3572)
is one. A merged branch makes the session leave its worktree with `ExitWorktree(action: "keep")`
and create a fresh one. An unmerged branch adopts the current worktree, as every clean worktree
did before the check existed. Before you choose a fail direction, name which verdict acts and
what each wrong answer costs.

- **Fail open toward the old behavior, and log the path.** When the check cannot run, fall through
  to what happened before it existed, with a logged `could not run ({reason})` line, not a stop.
  The degraded-online-check rule above guards prose that would act on "not landed" where acting
  is risky. Here acting on "not landed" is the old behavior, so there is nothing to stop for.
  When `gh` is absent, the PR read degrades on its own, as `_shared/github-write-transport.md`
  documents for PR list and view reads.
- **A weaker proof is acceptable only while a false "landed" costs nothing.**
  `gh pr list --head "{branch}" --state merged` proves that a PR from that branch name merged, not
  that HEAD's content landed. A reused branch name, or commits added after the merge, both read as
  merged. Here that only makes a fresh worktree and keeps the old one. Never reuse such a lookup
  to gate a delete or a discard. Use the squash row's content proof for those.
- **The PR lookup is the only signal that sees a squash. Pair it with a git check for merge
  commits.** A tip that is an ancestor of `origin/{integration-branch}` but absent from
  `git rev-list --first-parent origin/{integration-branch}` was merged by a merge commit. A fresh
  branch cut at an integration-branch commit sits on the first-parent line and is not merged.
