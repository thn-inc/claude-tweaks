# Parallel Development with Worktrees + Merge Reconciliation

For true parallel execution, run separate terminals with `worktree` mode — each terminal gets an isolated copy of the repository:

```
# Terminal 1                          # Terminal 2                          # Terminal 3
/claude-tweaks:flow 42 worktree      /claude-tweaks:flow 45 worktree      /claude-tweaks:flow 48 worktree
```

Each terminal creates its own worktree and feature branch. There is no file overlap risk because each worktree is a full, isolated copy.

## When to use worktree mode

- **Parallel work** — multiple specs building simultaneously in separate terminals
- **Team projects** — isolated branches ready for PR review
- **Risky changes** — experiment without affecting the main working tree

## When to use current-branch mode

- **Solo work** — simple, sequential, fast
- **Quick specs** — low risk, no isolation needed
- **Single terminal** — no need for parallel execution

## Merge Reconciliation (after parallel worktree runs)

After all terminals complete, merge the feature branches back.

**`integration-model: pr-first` (`_shared/integration-model.md`):** each terminal's run already
opened its own draft PR at run start (`_shared/pr-early-run-lifecycle.md`) — reconcile by
readying and merging each one via `_shared/pr-first-merge.md`'s procedure (`tag: fast-lane`,
`issue-list` that run's own record(s), and its Step 2.5 Merge-verification gate included — a red PR
in the sequence parks and reports pending-review while the remaining branches still merge in
order), sequentially in **Merge Order** below. No checkout is
needed for the merge itself, so none of the rest of this section's worktree-assignment
clearing, `close-run`, or gate-coverage prose applies — skip straight to **Merge Order**, run
each branch's merge via that shared procedure instead of this file's own `git merge`, and use its
**Conflict path** (one update-from-base attempt, then hand off) in place of the **Merge Procedure**
conflict branch below, which is `local-merge`-only.

**`integration-model: local-merge`:** the rest of this section — read on.

Close each branch's run only when that branch is about to merge — never every run up front. `close-run` clears a run's worktree assignment and `active` status, the teardown protection an unmerged branch still needs, so a branch that is skipped, aborted, or stopped by a failed check keeps it. Only the runs of the branches this reconciliation merges are ever closed — never another session's unrelated run.

The working-directory hook (E1) checks `git commit` against the newest non-terminal run in the project, whoever owns it: it denies the commit unless the commit targets that run's own worktree, another live run's worktree, or a different repository, or that run is provably another session's. The main checkout is none of these, so a commit there is denied while that run is live. For `git push` it only logs. It does not gate `git merge`, so the merge itself needs nothing closed first. The conflict path's resolution ends in a commit, which a still-assigned run can block — so a branch's run is closed before its conflict is resolved (step 5 below).

If the project also has `worktree-always: true` set (`.claude-tweaks/policy.yml`), a second, run-independent gate (`checkWorktreeRequired` in `pre-tool-use.js`) still applies, and `close-run` does nothing for it — it never reads run state, only whether the target is already inside a linked worktree. For exactly what that gate intercepts, read the `worktree-always` coverage block in `_shared/policy-schema-coverage.md`; it is the canonical list and this file deliberately does not restate it.

Two consequences for the sequence below. **`git merge` is not gated**, so the merge itself runs from the main checkout normally. **`git push` is**, so it must run from inside a linked worktree — and as a *separate* Bash call, since chaining merge-and-push into one command gets the whole invocation denied before either half runs. The gate also bites on a merge **conflict**: resolving one means editing files in the main checkout and then committing there, both denied since the main checkout is never a linked worktree. See the conflict branch of the Merge Procedure below, `dispatch/settle-and-merge.md`'s local-merge fallback (which carries the same two-call shape), and `_shared/git-discipline.md`.

**Shell state does not survive between separate Bash calls** — read every value first and substitute it literally into the next call.

### Merge Order

1. Sort completed branches by diff size (smallest first — run `git diff --stat {base-branch}..{branch}` and read the summary line at the end of its output)
2. Merge branches sequentially into the base branch

### Merge Procedure (`local-merge` only — `pr-first` uses `_shared/pr-first-merge.md` per above)

For each completed branch (in order):

1. **Find the branch's run and read its worktree — before anything closes it.** `close-run` nulls `run-state.json`'s `worktree` field, so read it now. `{run-dir}` is the run directory whose recorded worktree has `{branch}` checked out, as the absolute `$RUN_ROOT/.claude-tweaks/pipelines/<id>` path per `_shared/pipeline-run-dir.md`, passed as an argument so no path character reaches the script text. Candidates are the run dirs whose `run-state.json` status is not `clean`. Run this pair per candidate and keep the one whose second line prints `{branch}`:

   ```bash
   node -e "const w=require(process.argv[1]+'/run-state.json').worktree; if(!w){console.error('claude-tweaks: run-state.json has no worktree field — cannot resolve the worktree to merge'); process.exit(1);} console.log(w)" "{run-dir}"   # -> {worktree-path}
   git -C "{worktree-path}" branch --show-current                       # -> must print {branch}
   ```

   A `node` error (a missing or unparseable `run-state.json`) is not a non-match — stop and report it. No run dir matches → this branch has no run to protect: run steps 2 and 4 for it, with no `close-run` and no re-protect anywhere below, step 5 included.

2. **Pre-merge checks, from the main checkout — nothing mutated.** Verify the main checkout is on `{base-branch}` — a concurrent session may have switched it underfoot (`[IL-05]`) — then compose the subject and predict the merge. For record-derived runs (any materialized file under `{run-dir}/work/` on the branch carries a `record:` field in its header — see `materialize.md`), the merge commit message carries the closing keywords — one line per issue (see "Close-via-merge" in `_shared/issue-claims.md`):

   ```bash
   CURRENT=$(git branch --show-current)
   if [ "$CURRENT" != "{base-branch}" ]; then
     echo "Main checkout is on '$CURRENT', not '{base-branch}' — a concurrent session switched it. Abort, do not merge." >&2
     exit 1
   fi
   node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue} {second-issue} --range {base-branch}...{branch} --out-dir "{subject-dir}" || exit 1
   git merge-tree --write-tree --name-only {base-branch} {branch} || exit 1
   ```

   `{subject-dir}` resolves per `_shared/pr-first-merge.md` Step 3. A branch with no record drops the composer line here and the `-F` in step 4. The issues close when step 6 pushes the base branch to the default remote branch. `git merge-tree` writes only unreferenced objects — never the working tree, the index, or a ref.

   Nothing is closed yet, so every way this fence stops leaves the run exactly as it was:
   - **The branch guard aborted** — stop the reconciliation; the checkout moved underneath it. Then run step 6 for the branches already merged (push, or re-protect on push failure).
   - **The composer failed** (nothing merged): record the composer's stderr, skip this branch, and continue with the next one — a record with no resolvable Type or a `breaking` label with no `## Breaking Change` section is a shaping defect to fix on the record, not a merge problem; a malformed `commit-scope-paths` entry, a `commit-scope` token the composer rejects, a failed `--range` diff, or this fence passing no `--range` while `commit-scope-paths` is set is a policy or invocation fault to fix in `policy.yml` or in this fence.
   - **A predicted conflict** — a `CONFLICT` line on `git merge-tree`'s stdout: go to step 5. An error on stderr with no `CONFLICT` line means git could not run the pre-check (git older than 2.38, an unknown ref): record it and skip this branch.

3. **Close this branch's run — only now, once its pre-merge checks passed**, as its own Bash call:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "{run-dir}"
   ```

   Only this branch's run, never a sweep of `.claude-tweaks/pipelines/*/`. Fail-open: it never blocks the merge below.

4. **Merge, from the main checkout.** The guard repeats step 2's check as the race backstop:

   ```bash
   CURRENT=$(git branch --show-current)
   if [ "$CURRENT" != "{base-branch}" ]; then
     echo "Main checkout is on '$CURRENT', not '{base-branch}' — a concurrent session switched it. Abort, do not merge." >&2
     exit 1
   fi
   git merge --no-ff {branch} -F "{subject-dir}/message.txt"
   ```

   - **Merged** — record the merge commit (`git rev-parse {base-branch}`) and continue to the next branch.
   - **The branch guard aborted** (stderr ends `Abort, do not merge.`; no merge started — the checkout moved after step 3 closed the run) — re-protect this branch's run (**Re-protect** below), then stop the reconciliation and run step 6 for the branches already merged.
   - **Failed** — if a `MERGE_HEAD` exists, run `git merge --abort`. Then re-protect this branch's run (**Re-protect** below). A conflict goes to step 5; any other failure is recorded as `merge aborted: {first stderr line}` and the branch is skipped.

5. **On a conflict** (predicted at step 2, or hit at step 4) — present the conflicts:
   ```
   Merge conflict merging {branch}:

   Conflicting files:
   - {file1}
   - {file2}
   ```

   Call `AskUserQuestion`:
   - `question`: `"How do you want to handle this merge conflict?"`, `header`: `"Merge conflict"`, `multiSelect`: `false`
   - Option 1 — `label`: `"Resolve now (Recommended)"`, `description`: `"I'll resolve based on both branches' intent"`
   - Option 2 — `label`: `"Skip this branch"`, `description`: `"merge remaining branches first, come back to this one"`
   - Option 3 — `label`: `"Abort remaining merges"`, `description`: `"I'll handle merges manually"`

   - **Resolve now** → this branch's run is closed first, if it has one and it is not closed already: run step 3's fence for it (after a step 4 failure it was re-protected, so it must be closed again). The resolution ends in a commit E1 checks against the newest non-terminal run in the project. If E1 still denies that commit, its deny message names the worktree the run it checked is assigned to — find the run dir whose `run-state.json` records that worktree. When that run belongs to another branch in this reconciliation, read that run's worktree with step 1's pair first, then close it with step 3's fence, and re-protect it (**Re-protect** below) once the resolution lands. Closing it moves E1 to the next-newest live run, so repeat until the commit passes, applying the same rule to each run: close it if it is a branch of this reconciliation, otherwise it is not this reconciliation's to close — treat the resolution as abandoned (below) and report that run. "The resolution lands" means the `git commit --no-edit --cleanup=strip` below (no `worktree-always`) or the fast-forward below (`worktree-always`).

     Without `worktree-always`, there is no merge in progress to resolve: step 4 aborts every failed merge, and a conflict predicted at step 2 never started one. Re-run step 4's fence and, on the conflict, leave the merge in place — do not take step 4's **Failed** bullet. Resolve the files, stage them, then commit with `git commit --no-edit --cleanup=strip` (`MERGE_MSG` carries `message.txt`'s closing keywords; `--cleanup=strip` drops git's `# Conflicts:` comment lines).

     If `worktree-always: true` is set, don't resolve "Resolve now" directly in the main checkout — `Edit`/`Write` there is denied regardless of `close-run` (see above). Instead, provision a scratch worktree off `{base-branch}` per `_shared/scratch-worktree.md` §2 (native `EnterWorktree` when available, `git worktree add` under `.worktrees/` as the documented fallback only — never under `.claude/worktrees/`, that section's own ADR-0004 domain rule), re-run step 4's merge (`git merge --no-ff {branch} -F "{subject-dir}/message.txt"`) there, resolve and commit inside that worktree (a linked worktree, so both gates pass), verify, then fast-forward the main checkout to the result the same way `_shared/scratch-worktree.md` §5 does — verifying the branch in the same compound command so a concurrent session that switched it underfoot can't merge onto the wrong branch (`[IL-05]`; same shape as the precedent in `dispatch/settle-and-merge.md`'s local-merge fallback):

     ```bash
     [ "$(git branch --show-current)" = "{base-branch}" ] && git merge --ff-only <sha>
     ```

     `<sha>` is the scratch worktree's HEAD after resolving and committing — resolve it there with `git rev-parse HEAD` and paste the literal value in (`_shared/scratch-worktree.md` §7). `git merge` itself is ungated and this fast-forward creates no new commit. Tear the scratch worktree down via `ExitWorktree` per that file's §6 — never a raw `git worktree remove`, which fails on the worktree's own live lock (`[IL-58]`); the same Teardown ordering invariant `wrap-up/cleanup-procedures-execution.md` Section C states for a run's own worktree applies here — removal is the last action against the scratch worktree, only after the fast-forward above has landed. This scratch-worktree ceremony is `local-merge`-only — the `pr-first` path above never needs it, since its own conflict path surfaces inside the run's own real worktree, not the main checkout.

     Once the resolution lands, record the merge commit and continue. If the resolution is abandoned or stopped before it lands (run `git merge --abort` first if a merge is in progress), re-protect every run closed for it — this branch's and every run closed to pass E1.
   - **Skip this branch** → this branch's run keeps its worktree assignment and `active` status: never closed when step 2 predicted the conflict, re-protected already when step 4 hit it. Merge the remaining branches, then return to this one from step 1.
   - **Abort remaining merges** → stop. This branch's run, and every remaining branch's, keeps its worktree assignment and `active` status — none is closed, and a run step 4 closed was re-protected already. Report the branches left, then run step 6 for the branches already merged (push, or re-protect on push failure).

6. **Push the base branch once, after every branch is merged or skipped** — from inside a linked worktree (the `worktree-always` gate) and as its own Bash call: `git -C "{worktree-path}" push origin {base-branch}`, with any reconciled branch's worktree that still exists. **On push failure** — or when no linked worktree is left to push from — every merge in this reconciliation is local-only: re-protect every run step 3 closed, once per run, leave the local merge commits for a human to push, and report it. Once the base branch is pushed, run `_shared/pr-first-merge-post-merge.md` Step 4.1 against each recorded merge commit with `--ref {integration-branch}` — same outcomes and staged file, closing-report line only (no PR to comment on).

### Re-protect

After any failure that follows a branch's `close-run` — a step 4 branch-guard abort, a step 4 merge failure, a step 5 resolution abandoned or stopped before it lands, or a step 6 push failure — re-stamp that branch's run with the `{worktree-path}` step 1 read (`run-state.json` no longer holds it), one Bash call per run:

```bash
env -u CLAUDE_CODE_SESSION_ID node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{run-dir}" "{worktree-path}"
```

`env -u CLAUDE_CODE_SESSION_ID` keeps the run's original owner: `record-worktree` stamps the calling session's id into the run otherwise, handing another terminal's run to the reconciling session. `record-worktree` restores the worktree assignment and `active` status. It prints `claude-tweaks: worktree recorded for …` when it worked; any other line (the run dir may have been archived underneath) is not ignored — log any other line to that run's `decisions.md` and name it in the Post-Merge Summary:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --status AUTO --section "/flow" --step "worktree-merge reconciliation" --text-file "{text-file}" --reversibility high
```

`{text-file}` holds one line, `Re-stamp of {branch} after {failure} did not print worktree recorded: {output line}`, written per `_shared/auto-decision-log.md`'s "Text from git or a user" paragraph — the branch name and the hook's output are git- and tool-supplied, so they never pass through shell quoting. If this log call fails too (an archived run dir exits 3), name both outputs in the Post-Merge Summary's `Re-protect failed` row.

### Post-Merge Summary

```markdown
### Merge Results

| Branch | Spec | Merge Status |
|--------|------|-------------|
| {branch} | {spec} | Merged cleanly |
| {branch} | {spec} | Merged with conflict resolution |
| {branch} | {spec} | Skipped (conflict) — run still active |
| {branch} | {spec} | Merge failed — run re-protected |
| {branch} | {spec} | Merged locally, push failed — run re-protected |
| {branch} | {spec} | Not merged (pre-merge check failed: {reason}) — run still active |
| {branch} | {spec} | Not merged (aborted) — run still active |
| {branch} | {spec} | Not merged (checkout moved before the merge) — run re-protected |
| {branch} | {spec} | Re-protect failed: {output line} — run unprotected |
| {branch} | {spec} | Skipped (pipeline failed) |
```

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:flow {spec} worktree {remaining steps}`** — re-run for any failed specs (recommended)
`/claude-tweaks:help` — full pipeline status
