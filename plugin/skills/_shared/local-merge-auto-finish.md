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

Reuses the git mechanics `wrap-up/auto-merge-short-circuit.md`'s own `integration-model: local-merge`
branch (lines 123-207 as of this writing) already proved for its grant-gated fast-lane path — this
file reaches the same mechanics through a different, ungated gate (the Precondition above, not a
`merge-check` verdict or an `auto:merge` label). Cite that section's rationale rather than duplicating
it; the steps below restate the commands so this auto branch never needs to invoke
`finishing-a-development-branch`'s own interactive Step 4 menu.

**Shell state does not survive between separate Bash calls** — read every value first and substitute
it literally into the next call; never carry it in a shell variable across calls (same warning
`auto-merge-short-circuit.md` states for its own two-call shape).

1. **Resolve the base/integration branch** — `_shared/integration-branch.md`'s canonical resolution
   (never asked; this is exactly the "confirm before merging" step `finishing-a-development-branch`
   asks a human for, replaced here by the same resolution `auto-merge-short-circuit.md`'s local-merge
   branch already uses):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values integration-branch
   ```

2. **Clear this run's worktree assignment before merging** — `close-run` first, so the merge landing
   in the main checkout isn't denied as a wrong-checkout commit (same as
   `auto-merge-short-circuit.md`'s local-merge branch):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "$RUN_DIR"
   ```

   This call is fail-open by design (same as `auto-merge-short-circuit.md`'s identical call) — it
   never blocks the procedure below regardless of its own outcome.

3. **Read the worktree path and feature branch** — from `run-state.json`'s own `worktree` field
   (`record-worktree` stamped it there), never `$RUN_DIR` itself (`$RUN_DIR` sits inside the main
   checkout per `_shared/pipeline-run-dir.md`'s anchoring rule):

   ```bash
   node -e "const w=require('$RUN_DIR/run-state.json').worktree; if(!w){console.error('claude-tweaks: run-state.json has no worktree field — cannot resolve the worktree to merge'); process.exit(1);} console.log(w)"   # -> {worktree-path}
   git -C "{worktree-path}" branch --show-current                       # -> {feature-branch}
   ```

   A missing or empty `worktree` field is a defect in the run's own bookkeeping, not a mergeable
   state — abort here (do not fall through to a `git -C "undefined"` command) and treat it the same
   as the Park branch below: nothing has been merged yet, so `pending-review` is the correct outcome.

4. **Merge, from the main checkout.** Verify the main checkout is actually on the resolved base
   branch first — a concurrent session may have switched it underfoot (`[IL-05]`):

   ```bash
   CURRENT=$(git branch --show-current)
   if [ "$CURRENT" != "{base-branch}" ]; then
     echo "Main checkout is on '$CURRENT', not '{base-branch}' — a concurrent session switched it. Abort, do not merge." >&2
     exit 1
   fi
   ```

   **On abort** (the branch check above failed): nothing has been merged — this is not a distinct
   third outcome, it is the same unmergeable state the Park branch below handles. Log it via the
   Park branch's `log-decision.js` call, with `{conflict|failed verification}` replaced by
   `"main checkout switched to '$CURRENT' underfoot"`, and report `pending-review` to the caller —
   never a bare non-zero exit with no logged outcome, per this file's own invariant that every run
   ends in an explicit, logged outcome.

   ```bash
   SUBJECT_EXPORTS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue} --tag auto-finish --shell) || exit 1
   eval "$SUBJECT_EXPORTS"
   git merge --no-ff {feature-branch} -m "$SUBJECT_TITLE

$SUBJECT_BODY"
   ```

   **On a composer failure** (the `|| exit 1` above fired — `compose-subject.js` printed its
   reason to stderr and nothing has been merged): the same Park branch below applies, with
   `{conflict|failed verification}` replaced by `"composer failed: {first stderr line}"` — a
   record with no resolvable Type, or a `breaking` label with no `## Breaking Change` section, is
   a shaping defect to fix on the record, not a merge problem; report `pending-review` to the
   caller.

   `--no-ff` guarantees a real merge commit exists to carry the composer's `Fixes #{issue}` closing keyword (`bin/compose-subject.js` — Conventional-Commits subject, `[auto-finish]` body tag) —
   the same reason `cleanup-procedures-execution.md` Section C step 2's own carrier commit exists.
   That carrier commit already guarantees closure regardless, so this is redundant-but-safe, never
   harmful.

   **On any failure** (`git merge` exits non-zero, for any reason — conflict markers, a `CONFLICT`
   report, a dirty working tree ("local changes would be overwritten"), unrelated histories, or any
   other failure this procedure doesn't specifically recognize): if a `MERGE_HEAD` exists (a real
   conflict was entered), run `git merge --abort` to return to the pre-merge state; otherwise the
   merge never started and the checkout is already unchanged. Either way, this is the one point in
   this procedure that must never attempt resolution — `_shared/auto-mode-contract.md`'s "does NOT
   silence" table states plainly: "Resolution of merge conflicts in worktree finishing | Conflict
   resolution requires intent the model cannot infer." Go to the **Park** branch below.

5. **Verify on the merged result** — run the project's verification command
   (`skills/test/verification.md`'s shared procedure) against the now-merged base branch.

   - **Green** → proceed to step 6.
   - **Red** → `git reset --hard ORIG_HEAD` (undo the local merge — nothing has been pushed, so this
     is fully recoverable) and go to the **Park** branch below. A merged-result test failure gets the
     identical treatment as a merge conflict: leave the worktree and feature branch exactly as they
     were, never force anything.

6. **Push** (from inside the worktree — naming the branch explicitly, since a bare `git push` from
   the worktree would push the *feature* branch, not the just-updated base branch; same reason
   `auto-merge-short-circuit.md`'s own local-merge push step states):

   ```bash
   git -C "{worktree-path}" push origin {base-branch}
   ```

   **On push failure** (non-zero exit — a rejected fast-forward, network failure, or permission
   error): the merge already landed locally in the main checkout, but nothing reached `origin` — do
   NOT report `merged`, since the caller's downstream steps (worktree removal, issue-claim release)
   assume the merge is durable, and a local-only merge is not. Log this outcome via the Park
   branch's `log-decision.js` call below, with `{conflict|failed verification}` replaced by
   `"push failed — local merge commit {sha} exists but is unpushed"`, and report `pending-review` to
   the caller. Do not retry the push automatically and do not undo the local merge — a human
   resuming this run needs the merge commit to still be there to push it themselves.

7. **Log the merged outcome** (push succeeded):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$RUN_DIR" --status AUTO \
     --section "/wrap-up" --step "Section C (local-merge-auto-finish)" \
     --text "Merged {feature-branch} into {base-branch} (commit {sha}), pushed. [outcome: merged]" \
     --reversibility high
   ```

   Report outcome `merged` to the caller — `cleanup-procedures-execution.md` Section C proceeds to
   its step 4 (worktree removal) exactly as though `finishing-a-development-branch` itself had
   reported "Merged, PR created, or discarded."

**Park branch (conflict or failed merged-result verification):**

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$RUN_DIR" --status AUTO \
  --section "/wrap-up" --step "Section C (local-merge-auto-finish)" \
  --text "Local merge into {base-branch} failed ({conflict|failed verification}) — reverted, worktree and branch preserved. [outcome: pending-review]" \
  --reversibility high
```

Report outcome `pending-review` to the caller. The worktree's *files* — the feature branch and its
commits — are untouched: a human can check out the branch, resolve or investigate, and re-run
finish exactly as if nothing had happened to the code. But the run's own bookkeeping is **not**
unchanged: step 2's `close-run` already fired, unconditionally, before the merge attempt — it lifts
the pipeline-run assignment that protects this worktree from teardown (`bin/lib/hooks/pre-tool-use.js`'s
teardown gate), so the worktree is reap-eligible from this point on, regardless of whether the merge
that followed succeeded or parked. A human resuming a parked run should treat the worktree as
time-sensitive: resolve it promptly, or re-run `record-worktree`/`close-run`'s counterpart to
re-establish the assignment before leaving it for later. Never `git merge --abort` twice, never
retry automatically, never widen scope to attempt a fix — this is the one decision
`_shared/auto-mode-contract.md`'s "does NOT silence" table reserves for a human: never attempt
conflict resolution under auto.

## Interactive mode is unaffected

This procedure never runs unless the Precondition above holds. A standalone or `interactive` run
reaches `cleanup-procedures-execution.md` Section C with no `config.yml` in its run directory and
falls straight through to the unmodified `/superpowers:finishing-a-development-branch` handoff,
exactly as before this file existed — Section C's own text states this fallback explicitly.
