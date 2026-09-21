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

Before the merge/finish handoff begins, clear each run's worktree assignment — merge and push happen in the main checkout legitimately, and the working-directory hook (E1) would otherwise deny them as a wrong-checkout commit. A single bare `close-run` closes only the newest run, so with multiple parallel terminals this is not enough: list `.claude-tweaks/pipelines/*/` and, for every run dir whose `run-state.json` status is not already `clean`, run `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "$dir"` explicitly before starting the merge/finish sequence.

`close-run` only satisfies E1. If the project also has `worktree-always: true` set (`.claude-tweaks/policy.yml`), a second, run-independent gate (`checkWorktreeRequired` in `pre-tool-use.js`) still applies, and `close-run` does nothing for it — it never reads run state, only whether the target is already inside a linked worktree. For exactly what that gate intercepts, read the `worktree-always` coverage block in `_shared/policy-schema-coverage.md`; it is the canonical list and this file deliberately does not restate it.

Two consequences for the sequence below. **`git merge` is not gated**, so the merge itself runs from the main checkout normally. **`git push` is**, so it must run from inside a linked worktree — and as a *separate* Bash call, since chaining merge-and-push into one command gets the whole invocation denied before either half runs. The gate also bites on a merge **conflict**: resolving one means editing files in the main checkout and then committing there, both denied since the main checkout is never a linked worktree. See the conflict branch of the Merge Procedure below, `dispatch/settle-and-merge.md`'s local-merge fallback (which carries the same two-call shape), and `_shared/git-discipline.md`.

### Merge Order

1. Sort completed branches by diff size (smallest first — run `git diff --stat {base-branch}..{branch}` and read the summary line at the end of its output)
2. Merge branches sequentially into the base branch

### Merge Procedure (`local-merge` only — `pr-first` uses `_shared/pr-first-merge.md` per above)

For each completed branch (in order):

1. Merge into the base branch. For record-derived runs (any materialized file under
   `{run-dir}/work/` on the branch carries a `record:` field in its header — see
   `materialize.md`), the merge commit message must carry the closing keywords — one line per
   issue (see "Close-via-merge" in `_shared/issue-claims.md`):

   ```bash
   SUBJECT_EXPORTS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue} {second-issue} --shell) || exit 1
   eval "$SUBJECT_EXPORTS"
   git merge --no-ff {branch} -m "$SUBJECT_TITLE

$SUBJECT_BODY"
   ```

   Otherwise a plain `git merge {branch}` is fine. The issues close when the user pushes the
   base branch to the default remote branch.
2. **If the composer call fails** (`|| exit 1`, before any merge): nothing has been merged; record the composer's stderr and stop the reconciliation for this branch — a record with no resolvable Type or a `breaking` label with no `## Breaking Change` section is a shaping defect to fix on the record, not a merge problem.
3. **If merge succeeds** — record the merge commit (`git rev-parse {integration-branch}`) and continue to the next branch. Once every branch is merged and the base branch has been pushed (the separate push the paragraph above describes), run `_shared/pr-first-merge-post-merge.md` Step 4.1 against each recorded merge commit with `--ref {integration-branch}` — same outcomes and staged file, closing-report line only (no PR to comment on).
4. **If merge conflicts** — present the conflicts:
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

   If `worktree-always: true` is set, don't resolve "Resolve now" directly in the main checkout — `Edit`/`Write` there is denied regardless of `close-run` (see above). Instead, provision a scratch worktree off `{base-branch}` per `_shared/scratch-worktree.md` §2 (native `EnterWorktree` when available, `git worktree add` under `.worktrees/` as the documented fallback only — never under `.claude/worktrees/`, that section's own ADR-0004 domain rule), re-run `git merge {branch}` there, resolve and commit inside that worktree (a linked worktree, so both gates pass), verify, then fast-forward the main checkout to the result the same way `_shared/scratch-worktree.md` §5 does — verifying the branch in the same compound command so a concurrent session that switched it underfoot can't merge onto the wrong branch (`[IL-05]`; same shape as the precedent in `dispatch/settle-and-merge.md`'s local-merge fallback):

   ```bash
   [ "$(git branch --show-current)" = "{base-branch}" ] && git merge --ff-only <sha>
   ```

   `<sha>` is the scratch worktree's HEAD after resolving and committing — resolve it there with `git rev-parse HEAD` and paste the literal value in; shell state doesn't survive between separate Bash calls (`_shared/scratch-worktree.md` §7). `git merge` itself is ungated and this fast-forward creates no new commit. Tear the scratch worktree down via `ExitWorktree` per that file's §6 — never a raw `git worktree remove`, which fails on the worktree's own live lock (`[IL-58]`); the same Teardown ordering invariant `wrap-up/cleanup-procedures-execution.md` Section C states for a run's own worktree applies here — removal is the last action against the scratch worktree, only after the fast-forward above has landed. This scratch-worktree ceremony is `local-merge`-only — the `pr-first` path above never needs it, since its own conflict path surfaces inside the run's own real worktree, not the main checkout.

### Post-Merge Summary

```markdown
### Merge Results

| Branch | Spec | Merge Status |
|--------|------|-------------|
| {branch} | {spec} | Merged cleanly |
| {branch} | {spec} | Merged with conflict resolution |
| {branch} | {spec} | Skipped (pipeline failed) |
```

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:flow {spec} worktree {remaining steps}`** — re-run for any failed specs (recommended)
`/claude-tweaks:help` — full pipeline status
