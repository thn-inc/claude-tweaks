# Local-Merge Sequence — one branch, guard to push

Canonical for merging one feature branch into the integration branch from the main checkout
under `integration-model: local-merge` (`_shared/integration-model.md`): the branch guard, the
pre-merge checks, `close-run`, the guarded merge, the explicit-branch-name push, and the
re-protect a failure after `close-run` owes. `pr-first` merges never run it — they go through
`_shared/pr-first-merge.md`.

It is a **single-branch** sequence. A caller that merges several branches loops Steps 1-3 once
per branch. This file recognizes each failure and says what state it leaves; it never decides
what the caller does next. Aborting, parking, falling back to a console, or skipping the branch
and continuing with the next one is the caller's routing, stated in the caller's own file.

## Bindings

The caller binds every placeholder before Step 1 and substitutes each value **literally** into
every call. Shell state does not survive between separate Bash calls — a variable set in one is
empty in the next, so never carry a value in a shell variable across calls.

- `{base-branch}` — the integration branch the caller resolved (`_shared/integration-branch.md`),
  never whatever branch the main checkout happens to have checked out: a concurrent session can
  switch that, and the branch guard exists to catch it (`[IL-05]`).
- `{branch}` — the feature branch to merge.
- `{issues}` — the record numbers this merge closes, space-separated: the composer's positional
  arguments, one `Fixes #N` line each ("Close-via-merge" in `_shared/issue-claims.md`). A caller
  with no record for this branch drops Step 1's composer line and Step 3's
  `-F "{subject-dir}/message.txt"`.
- `{tag}` — the composer's body tag, rendered as `[{tag}]`. A caller that names no tag drops
  `--tag {tag}` from Step 1's composer line.
- `{run-dir}` — the absolute run directory whose run protects `{branch}`'s worktree
  (`_shared/pipeline-run-dir.md`). A caller with no run for this branch skips Steps 2 and 5.
- `{subject-dir}` — resolves per `_shared/pr-first-merge.md` Step 3.
- `{worktree-path}` — a linked worktree to push from; for a single branch, the one that has
  `{branch}` checked out. A caller that reads it from `{run-dir}/run-state.json`'s `worktree`
  field does so **before Step 2** — `close-run` nulls that field, so a later read returns nothing.

## Why the order is load-bearing

`close-run` clears the run's protection — its worktree assignment and `active` status, the
teardown guard an unmerged branch still needs — so every check that can fail without touching
the tree runs before it (Step 1). The merge and the push necessarily follow it, and any failure
after it re-protects the run (Step 5). A failure in Step 1 leaves the run exactly as it was.

The working-directory hook (E1) does not gate `git merge`, so the merge needs nothing closed
first: `close-run` is the run finishing, not a merge prerequisite. Under `worktree-always: true`
the separate, run-independent gate (`checkWorktreeRequired` in `bin/lib/hooks/pre-tool-use.js`)
still denies `git push` and `git commit` from the main checkout, but never `git merge`, and
`close-run` does nothing for it. So the merge runs from the main checkout and the push from
inside a linked worktree. Run `close-run`, the merge and the push as three separate Bash calls —
never chain the push onto the merge or onto `close-run`: the gate inspects the whole command
string up front, so a compound call is denied before either half runs.
`_shared/policy-schema-coverage.md`'s `worktree-always` block lists what the gate intercepts.

## Step 1: Pre-merge checks — from the main checkout, nothing mutated

```bash
if ! git branch --show-current | grep -qxF '{base-branch}'; then
  echo "Main checkout is not on '{base-branch}' — a concurrent session switched it. Abort, do not merge." >&2
  exit 1
fi
node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issues} --tag {tag} --range {base-branch}...{branch} --out-dir "{subject-dir}" || exit 1
git merge-tree --write-tree --name-only {base-branch} {branch} || exit 1
```

`git merge-tree` writes only unreferenced objects — never the working tree, the index, or a ref.
Any non-zero exit means nothing was merged and `close-run` has not run, so there is nothing to
undo and nothing to re-protect. Tell the failures apart by their output:

- **The branch guard aborted** — stderr ends `Abort, do not merge.`: the checkout moved
  underneath the caller.
- **The composer failed** — `compose-subject.js` printed its reason on stderr. A record with no
  resolvable Type, or a `breaking` label with no `## Breaking Change` section, is a shaping
  defect to fix on the record, not a merge problem. A malformed `commit-scope-paths` entry, a
  `commit-scope` token the composer rejects, a failed `--range` diff, or a call passing no
  `--range` while `commit-scope-paths` is set is a policy or invocation fault to fix in
  `policy.yml` or in this fence.
- **A predicted conflict** — a `CONFLICT` line on `git merge-tree`'s stdout.
- **The pre-check could not run** — a stderr error with no `CONFLICT` line (git older than 2.38
  lacks `--write-tree`, or an unknown ref). Record it as `pre-check failed: {first stderr line}`,
  never as a conflict. The `|| exit 1` collapses every `git merge-tree` failure to exit 1, so the
  output is the only way to tell this case from the one above.

## Step 2: Close the run — only once Step 1 passed, its own Bash call

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "{run-dir}"
```

It marks the run `clean`, so its worktree is released for teardown once the branch lands, and
nulls `run-state.json`'s `worktree` field. Close only this branch's run, never a sweep of
`.claude-tweaks/pipelines/*/`. Fail-open by design: it never blocks the merge below, whatever its
own outcome.

## Step 3: Merge — from the main checkout

The guard runs two checks before merging. The branch check repeats Step 1's as the race
backstop — a concurrent session may have switched the checkout since. The merge check refuses
when a merge is already in progress: a `MERGE_HEAD` there is not this sequence's, and `git merge`
would refuse to start anyway:

```bash
if ! git branch --show-current | grep -qxF '{base-branch}'; then
  echo "Main checkout is not on '{base-branch}' — a concurrent session switched it. Abort, do not merge." >&2
  exit 1
fi
if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
  echo "A merge is already in progress in the main checkout — not this sequence's. Abort, do not merge." >&2
  exit 1
fi
git merge --no-ff {branch} -F "{subject-dir}/message.txt"
```

`--no-ff` guarantees a real merge commit even when the branch would fast-forward: the commit the
composer's `[{tag}]` paragraph and `Fixes #N` lines land on.

**On failure** — what state each failure leaves:

- **A guard aborted** (either check — the stderr line names which): no merge of this sequence
  started, and the checkout is not this sequence's to touch — nothing to undo or abort.
- **`git merge` exited non-zero** (a conflict that appeared only after Step 1's prediction, the
  race it cannot rule out; a dirty working tree; unrelated histories): the guard ruled out a
  pre-existing merge, so a `MERGE_HEAD` now is this merge's. Check for it from the main checkout
  where the merge ran:

  ```bash
  git rev-parse -q --verify MERGE_HEAD
  ```

  Exit 0 means this merge is in progress. Non-zero means it never started and the checkout is
  unchanged.

What happens to an in-progress merge — abort it (`git merge --abort`, its own call) or leave it
in place to resolve — is the caller's routing. `close-run` already ran, so Step 5 applies to
every failure here.

## Step 4: Push — from inside the linked worktree, its own Bash call

```bash
git -C "{worktree-path}" push origin {base-branch}
```

Name the branch explicitly: a bare `git push` from the worktree pushes the *feature* branch,
since that is what is checked out there. Both checkouts share one `.git`, so pushing
`{base-branch}` from the worktree publishes exactly what the main checkout just merged.

A caller that merges several branches runs Step 4 once, after its last merge. A caller may run
its own step between Step 3 and Step 4 — verifying the merged result, say; a failure there
follows Step 2 too, so Step 5 applies.

**On push failure** (a rejected fast-forward, a network or permission error): the merge landed
locally but nothing reached `origin`. Never `git merge --abort` and never undo the local merge —
a human resuming the run needs that commit to push it. Step 5 applies.

## Step 5: Re-protect — after any failure that follows Step 2

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{run-dir}" "{worktree-path}"
```

One Bash call per closed run, with the `{worktree-path}` read before Step 2 (`run-state.json` no
longer holds it). `record-worktree` restores the worktree assignment and `active` status, so the
parked run is not reap-eligible while it waits (`bin/lib/hooks/pre-tool-use.js`'s teardown gate).
It prints `claude-tweaks: worktree recorded for …` when it worked; any other line (the run dir may
have been archived underneath) is never ignored — the caller logs it. A failure in Step 1 never
re-protects: nothing was closed.

`record-worktree` stamps the calling session's id into the run as its owner. A caller
re-protecting a run another session owns keeps that owner by running this call under
`env -u CLAUDE_CODE_SESSION_ID`.
