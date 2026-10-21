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

Reuses the git mechanics `wrap-up/auto-merge-short-circuit.md`'s own `integration-model: local-merge`
branch already proved for its grant-gated fast-lane path — this
file reaches the same mechanics through a different, ungated gate (the Precondition above, not a
`merge-check` verdict or an `auto:merge` label). Cite that section's rationale rather than duplicating
it; the steps below restate the commands so this auto branch never needs to invoke
`finishing-a-development-branch`'s own interactive Step 4 menu.

The order is load-bearing: `close-run` (step 4) clears the run's protection and its worktree
assignment, so every check that can run beforehand runs before it — the pre-merge checks (step 3)
run first, while a failure still leaves the run open and protected; the merge, the step 6 verify, and
the push necessarily follow it, and a failure after `close-run` re-protects the run in the **Park**
branch below.

**Shell state does not survive between separate Bash calls** — read every value first and substitute
it literally into the next call; never carry it in a shell variable across calls (same warning
`auto-merge-short-circuit.md` states for its own separate calls).

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

3. **Pre-merge checks, from the main checkout — nothing mutated.** Verify the main checkout is
   actually on the resolved base branch first — a concurrent session may have switched it underfoot
   (`[IL-05]`) — then compose the subject and predict the merge:

   ```bash
   CURRENT=$(git branch --show-current)
   if [ "$CURRENT" != "{base-branch}" ]; then
     echo "Main checkout is on '$CURRENT', not '{base-branch}' — a concurrent session switched it. Abort, do not merge." >&2
     exit 1
   fi
   node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue} --tag auto-finish --range {base-branch}...{feature-branch} --out-dir "{subject-dir}" || exit 1
   git merge-tree --write-tree --name-only {base-branch} {feature-branch} || exit 1
   ```

   `{subject-dir}` resolves per `_shared/pr-first-merge.md` Step 3. `git merge-tree` writes only
   unreferenced objects, never the working tree, the index, or a ref; it exits non-zero on a
   predicted conflict and on a ref it cannot merge.

   **On abort** (the branch check above failed): nothing has been merged and `close-run` has not
   run — this is not a distinct third outcome, it is the same unmergeable state the Park branch
   below handles. Log it via the Park branch's `log-decision.js` call, with
   `{conflict|failed verification}` replaced by
   `main checkout switched to '{current-branch}' underfoot` (`{current-branch}` is the branch name the
   guard's stderr printed, substituted literally — the shell's `$CURRENT` does not survive), and report `pending-review` to the caller —
   never a bare non-zero exit with no logged outcome, per this file's own invariant that every run
   ends in an explicit, logged outcome.

   **On a composer failure** (the first `|| exit 1` above fired — `compose-subject.js` printed its
   reason to stderr, nothing has been merged, and `close-run` has not run): this is not a bare,
   unlogged exit — log it via the Park branch's `log-decision.js` call below, with
   `{conflict|failed verification}` replaced by `"composer failed: {first stderr line}"` — a record
   with no resolvable Type, or a `breaking` label with no `## Breaking Change` section, is a shaping
   defect to fix on the record, not a merge problem; a malformed `commit-scope-paths` entry, a
   `commit-scope` token the composer rejects, a failed `--range` diff, or this call passing no
   `--range` while `commit-scope-paths` is set is a policy or invocation fault to fix in
   `policy.yml` or in this fence; report `pending-review` to the caller, per this file's own
   invariant that every run ends in an explicit, logged outcome.

   **On a predicted conflict** (the `git merge-tree` line's `|| exit 1` fired — a `CONFLICT` report
   on stdout, or a ref it cannot merge): nothing has been merged and `close-run` has not run. Log it
   via the Park branch's `log-decision.js` call, with `{conflict|failed verification}` replaced by
   `"predicted conflict: {first CONFLICT line}"`, and report `pending-review` — never attempt
   resolution. The `|| exit 1` collapses every `git merge-tree` failure to exit 1, so tell them apart
   by its output, not the fence's exit code: a `CONFLICT` line on stdout is a predicted conflict; an
   error on stderr with no `CONFLICT` line means git could not run the pre-check (e.g. git older
   than 2.38 lacks `--write-tree`, or an unknown ref) — log `"pre-check failed: {first stderr line}"`
   as the reason instead, not "predicted conflict".

4. **Clear this run's worktree assignment before merging** — only now, once the pre-merge checks
   passed. The run is finishing: `close-run` marks it `clean` so its worktree is released for
   teardown once the branch lands (same as `auto-merge-short-circuit.md`'s local-merge branch); the
   working-directory hook does not gate `git merge`, so the merge itself needs nothing closed. Run it
   as its own Bash call:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "$RUN_DIR"
   ```

   This call is fail-open by design (same as `auto-merge-short-circuit.md`'s identical call) — it
   never blocks the procedure below regardless of its own outcome.

5. **Merge, from the main checkout.** The guard repeats the pre-merge check as the race backstop — a
   concurrent session may have switched the checkout since step 3:

   ```bash
   CURRENT=$(git branch --show-current)
   if [ "$CURRENT" != "{base-branch}" ]; then
     echo "Main checkout is on '$CURRENT', not '{base-branch}' — a concurrent session switched it. Abort, do not merge." >&2
     exit 1
   fi
   git merge --no-ff {feature-branch} -F "{subject-dir}/message.txt"
   ```

   `--no-ff` guarantees a real merge commit exists to carry the composer's `Fixes #{issue}` closing keyword (`bin/compose-subject.js` — Conventional-Commits subject, `[auto-finish]` body tag) —
   the same reason `cleanup-procedures-execution.md` Section C step 2's own carrier commit exists.
   That carrier commit already guarantees closure regardless, so this is redundant-but-safe, never
   harmful.

   **On any failure** (this call's guard aborts, or `git merge` exits non-zero, for any reason — a
   conflict that appeared only after step 3's prediction (the race it cannot rule out), conflict
   markers, a `CONFLICT` report, a dirty working tree ("local changes would be overwritten"),
   unrelated histories, or any other failure this procedure doesn't specifically recognize): if a
   `MERGE_HEAD` exists (a real conflict was entered), run `git merge --abort` to return to the
   pre-merge state; otherwise the merge never started and the checkout is already unchanged. Either
   way, this is the one point in this procedure that must never attempt resolution —
   `_shared/auto-mode-contract.md`'s "does NOT silence" table states plainly: "Resolution of merge
   conflicts in worktree finishing | Conflict resolution requires intent the model cannot infer."
   Go to the **Park** branch below, with `{conflict|failed verification}` replaced by `conflict`
   for a merge conflict, or by `merge aborted: {first stderr line}` for the guard abort or any
   other failure.

6. **Verify on the merged result** — run the project's verification command
   (`skills/test/verification.md`'s shared procedure) against the now-merged base branch.

   - **Green** → proceed to step 7.
   - **Red** → `git reset --hard ORIG_HEAD` (undo the local merge — nothing has been pushed, so this
     is fully recoverable) and go to the **Park** branch below. A merged-result test failure gets the
     identical treatment as a merge conflict: leave the worktree and feature branch exactly as they
     were, never force anything.

7. **Push** (from inside the worktree — naming the branch explicitly, since a bare `git push` from
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

8. **Log the merged outcome** (push succeeded):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$RUN_DIR" --status AUTO \
     --section "/wrap-up" --step "Section C (local-merge-auto-finish)" \
     --text "Merged {feature-branch} into {base-branch} (commit {sha}), pushed. [outcome: merged]" \
     --reversibility high
   ```

   Report outcome `merged` to the caller — `cleanup-procedures-execution.md` Section C proceeds to
   its step 4 (worktree removal) exactly as though `finishing-a-development-branch` itself had
   reported "Merged, PR created, or discarded."

**Park branch (an unmergeable state — abort, composer failure, conflict, failed merged-result verification, or push failure):**

**If the park was reached after step 4** (a merge failure from step 5, a red verification from step 6,
or a push failure from step 7), re-protect the run first. `close-run` already ran, so the parked run
would otherwise be unprotected with its worktree assignment cleared; re-stamp it with the
`{worktree-path}` step 2 read (`run-state.json` no longer holds it), its own Bash call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "$RUN_DIR" "{worktree-path}"
```

`record-worktree` restores the worktree assignment and `active` status. It prints `claude-tweaks: worktree recorded for …` when
it worked; any other line (the run dir may have been archived underneath) is not ignored — carry it
into the `--text` of the log call below. A park reached from step 2 or step 3 runs no re-stamp:
`close-run` has not fired, so nothing was closed.

Then log the outcome:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$RUN_DIR" --status AUTO \
  --section "/wrap-up" --step "Section C (local-merge-auto-finish)" \
  --text 'Local merge into {base-branch} failed ({conflict|failed verification}) — reverted, worktree and branch preserved. [outcome: pending-review]' \
  --reversibility high
```

The substituted reason can carry a filename or stderr text, so `--text` is single-quoted — never
double-quoted, where `$(…)`, backticks and `$VAR` would execute — and any `'` in the substituted
reason is written `'\''`.

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
