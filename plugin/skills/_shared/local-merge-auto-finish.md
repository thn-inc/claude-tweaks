# Local-Merge Auto-Finish — no-prompt branch-finish default

Canonical for the `local-merge` + non-interactive-mode no-prompt path through
`/superpowers:finishing-a-development-branch`'s merge/PR/discard/keep-as-is decision. Cited from
`wrap-up/cleanup-procedures-execution.md` Section C. Mirrors `_shared/pr-first-merge.md`'s role for
`pr-first` — the default policy that applies when no human is present to answer the menu, adapted
for a purely local merge (no forge, no PR to arm or wait on, no CI to poll).

## Why this exists

`pr-first` has had a no-prompt finish path since `_shared/pr-first-merge.md` (#411): a run under
`auto`/`hybrid`/`confirm` never blocks on a human choosing what to do with the PR. `local-merge` —
the permanent no-forge fallback (`_shared/integration-model.md`) — had no equivalent:
`cleanup-procedures-execution.md` Section C called `/superpowers:finishing-a-development-branch`
unconditionally, presenting its interactive menu and waiting for an answer regardless of mode. This
file closes that gap (#771).

## Precondition

`integration-model` resolves `local-merge` (`_shared/integration-model.md`) for this run AND
`{run-dir}/config.yml` exists. The second condition is the established proxy for "this run is not
`interactive`" — `flow/manifesto.md` writes `config.yml` in every mode except `interactive`, and
`wrap-up/SKILL.md`'s own `ceremony-profile` read already leans on the same absence-means-interactive
signal rather than inventing a new one.

Absent either condition — `integration-model` resolves `pr-first` instead, or this run's directory
carries no `config.yml` (a standalone or `interactive` run, per `flow/manifesto.md`) — this file does
not apply. Fall back to the citing file's own unmodified `/superpowers:finishing-a-development-branch`
handoff, exactly as before this file existed.

## Default policy

The default outcome is **Merge locally** (`finishing-a-development-branch`'s Option 1) — the only
sane default for a run with nobody present to answer a menu:

- **Push + Create PR is never a default** — `local-merge` is the no-forge fallback by definition
  (`_shared/integration-model.md`); there may be nothing to open a PR against.
- **Discard is never a default** — `finishing-a-development-branch`'s own rule holds regardless of
  mode: "Discarding the work happens only in response to your human partner explicitly asking for
  it." An unattended run has no human present to ask, so this path is simply never reached.
- **Keep-as-is is never a default** — it would leave the worktree, branch, and issue claim open with
  nothing finished, defeating the entire point of a hands-off run. A run that cannot merge cleanly
  parks instead (see Procedure below) — parking is distinct from keep-as-is: it is an explicit,
  logged failure state, not a silent no-op.

This must not silently skip the merge decision: every run through this file ends in an explicit,
logged outcome (`merged` or `pending-review`) — never a bare pass-through.

## Procedure

Print a one-line FYI before starting — `Integration model: local-merge — merging locally` (record
#2701) — never a question: the Precondition above already establishes nobody is present to answer
one, and `_shared/integration-model.md` has already resolved which model applies.

This file's steps 3-5 and 7 run `_shared/local-merge-sequence.md` — the single-branch local-merge sequence
(pre-merge checks, `close-run`, guarded merge, explicit-branch push, re-protect) and why its order
is load-bearing; read it before step 3. This file keeps its bindings, the merged-result
verification it runs between the sequence's merge and push (step 6), and what each failure the
sequence recognizes means here. It reaches that sequence through a different, ungated gate from
`wrap-up/auto-merge-short-circuit.md`'s — the Precondition above, not a `merge-check` verdict or
an `auto:merge` label — so this auto branch never invokes `finishing-a-development-branch`'s own
interactive Step 4 menu. A failure before step 4's `close-run` parks with nothing to undo; a
failure after it re-protects the run in the **Park** branch below.

**Shell state does not survive between separate Bash calls** — read every value first and substitute
it literally into the next call; never carry it in a shell variable across calls (the same rule
`_shared/local-merge-sequence.md`'s Bindings section states).

1. **Resolve the base/integration branch** — `_shared/integration-branch.md`'s canonical resolution
   (never asked; this is exactly the "confirm before merging" step `finishing-a-development-branch`
   asks a human for, replaced here by the same resolution `auto-merge-short-circuit.md`'s local-merge
   branch already uses):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values integration-branch
   ```

2. **Read the worktree path and feature branch** — before `close-run` (step 4), which nulls
   `run-state.json`'s `worktree` field, so a later read returns nothing. Read it from that field
   (`record-worktree` stamped it there), never `$RUN_DIR` itself (`$RUN_DIR` sits inside the main
   checkout per `_shared/pipeline-run-dir.md`'s anchoring rule):

   ```bash
   node -e "const w=require('$RUN_DIR/run-state.json').worktree; if(!w){console.error('claude-tweaks: run-state.json has no worktree field — cannot resolve the worktree to merge'); process.exit(1);} console.log(w)"   # -> {worktree-path}
   git -C "{worktree-path}" branch --show-current                       # -> {feature-branch}
   ```

   A missing or empty `worktree` field is a defect in the run's own bookkeeping, not a mergeable
   state — abort here (do not fall through to a `git -C "undefined"` command) and treat it the same
   as the Park branch below: nothing has been merged yet, so `pending-review` is the correct outcome.

3. **Pre-merge checks** — `_shared/local-merge-sequence.md` Step 1, from the main checkout.

   **Bindings:** `{base-branch}` = step 1's value, `{branch}` = `{feature-branch}`, `{issues}` = `{issue}`, `{tag}` = `auto-finish`, `{run-dir}` = `$RUN_DIR`'s value, `{worktree-path}` = step 2's value.

   Nothing has been merged and `close-run` has not run on any failure here, so each goes to the
   **Park** branch below with no re-stamp, its `log-decision.js` call taking
   `{conflict|failed verification}` replaced as follows, and reports `pending-review` — never a
   bare non-zero exit with no logged outcome, per this file's own invariant that every run ends in
   an explicit, logged outcome:

   - **The branch guard aborted** — `main checkout switched to '{current-branch}' underfoot`
     (`{current-branch}` is what `git branch --show-current` prints, run as its own call and
     substituted literally).
   - **The composer failed** — `"composer failed: {first stderr line}"`.
   - **A predicted conflict** — `"predicted conflict: {first CONFLICT line}"`; never attempt
     resolution.
   - **The pre-check could not run** — `"pre-check failed: {first stderr line}"`.

4. **Close the run** — `_shared/local-merge-sequence.md` Step 2, only once step 3 passed. The run
   is finishing: `close-run` marks it `clean` so its worktree is released for teardown once the
   branch lands.

5. **Merge** — `_shared/local-merge-sequence.md` Step 3, from the main checkout. Its `--no-ff`
   merge commit carries the composer's `Fixes #{issue}` closing keyword and `[auto-finish]` body
   tag — the same reason `cleanup-procedures-execution.md` Section C step 2's own carrier commit
   exists. That carrier commit already guarantees closure regardless, so this is
   redundant-but-safe, never harmful.

   **On any failure** (the step's guard aborts, or `git merge` exits non-zero for any reason):
   after a `git merge` failure with a merge in progress (the step's `MERGE_HEAD` check exits 0),
   this procedure aborts it with `git merge --abort` as its own call; after a guard abort it never
   aborts — the checkout is not this run's to touch. This is the one point in this procedure that
   must never attempt resolution — `_shared/auto-mode-contract.md`'s "does NOT silence" table
   states plainly: "Resolution of merge conflicts in worktree finishing | Conflict resolution
   requires intent the model cannot infer." Go to the **Park** branch below, with
   `{conflict|failed verification}` replaced by `conflict` for a merge conflict, or by
   `merge aborted: {first stderr line}` for the guard abort or any other failure.

6. **Verify on the merged result** — run the project's verification command
   (`skills/test/verification.md`'s shared procedure) against the now-merged base branch.

   - **Green** → proceed to step 7.
   - **Red** → `git reset --hard ORIG_HEAD` (undo the local merge — nothing has been pushed, so this
     is fully recoverable) and go to the **Park** branch below. A merged-result test failure gets the
     identical treatment as a merge conflict: leave the worktree and feature branch exactly as they
     were, never force anything.

7. **Push** — `_shared/local-merge-sequence.md` Step 4, from inside the worktree step 2 read.

   After a successful push, run `_shared/pr-first-merge-post-merge.md` Step 4.0b against the pushed
   merge commit (no PR, so `$MERGING_PR` is empty), logging to `$RUN_DIR/decisions.md`.

   **On push failure** (non-zero exit — a rejected fast-forward, network failure, or permission
   error): the merge already landed locally in the main checkout, but nothing reached `origin` — do
   NOT report `merged`, since the caller's downstream steps (worktree removal, issue-claim release)
   assume the merge is durable, and a local-only merge is not. Log this outcome via the Park
   branch's `log-decision.js` call below, with `{conflict|failed verification}` replaced by
   `"push failed — local merge commit {sha} exists but is unpushed"`, and report `pending-review` to
   the caller. Do not retry the push automatically and do not undo the local merge — a human
   resuming this run needs the merge commit to still be there to push it themselves.

8. **Log the merged outcome** (push succeeded):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$RUN_DIR" --status AUTO \
     --section "/wrap-up" --step "Section C (local-merge-auto-finish)" \
     --text-file "{text-file}" \
     --reversibility high
   ```

   `{text-file}` holds one line, `Merged {feature-branch} into {base-branch} (commit {sha}), pushed. [outcome: merged]`, written per `_shared/auto-decision-log.md`'s Text from git or a user paragraph — the branch names are git-supplied, so they never pass through shell quoting.

   Report outcome `merged` to the caller — `cleanup-procedures-execution.md` Section C proceeds to
   its step 4 (worktree removal) exactly as though `finishing-a-development-branch` itself had
   reported "Merged, PR created, or discarded."

**Park branch (an unmergeable state — abort, composer failure, conflict, failed merged-result verification, or push failure):**

**If the park was reached after step 4** (a merge failure from step 5, a red verification from step 6,
or a push failure from step 7), re-protect the run first — `_shared/local-merge-sequence.md` Step 5,
with the `{worktree-path}` step 2 read. When it does not print `worktree recorded`, its output line
is not ignored — carry it into the log call's `{text-file}` below. A park reached from step 2 or
step 3 runs no re-stamp: `close-run` has not fired, so nothing was closed.

Then log the outcome:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$RUN_DIR" --status AUTO \
  --section "/wrap-up" --step "Section C (local-merge-auto-finish)" \
  --text-file "{text-file}" \
  --reversibility high
```

`{text-file}` holds one line, `Local merge into {base-branch} failed ({conflict|failed verification}) — reverted, worktree and branch preserved. [outcome: pending-review]`, written per `_shared/auto-decision-log.md`'s Text from git or a user paragraph — the substituted reason can carry a filename or stderr text, so it never passes through shell quoting.

Report outcome `pending-review` to the caller. The worktree's *files* — the feature branch and its
commits — are untouched: a human can check out the branch, resolve or investigate, and re-run
finish exactly as if nothing had happened to the code. The run's own bookkeeping is protected the
same way: a park before step 4 never lifted the pipeline-run assignment that guards this worktree
from teardown (`bin/lib/hooks/pre-tool-use.js`'s teardown gate), and a park after it restored that
assignment with the re-stamp above — so the worktree is not reap-eligible while it waits. Never
`git merge --abort` twice, never retry automatically, never widen scope to attempt a fix — this is
the one decision `_shared/auto-mode-contract.md`'s "does NOT silence" table reserves for a human:
never attempt conflict resolution under auto.

## Interactive mode is unaffected

This procedure never runs unless the Precondition above holds. A standalone or `interactive` run
reaches `cleanup-procedures-execution.md` Section C with no `config.yml` in its run directory and
falls straight through to the unmodified `/superpowers:finishing-a-development-branch` handoff,
exactly as before this file existed — Section C's own text states this fallback explicitly.
