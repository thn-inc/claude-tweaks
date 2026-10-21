---
files:
  - plugin/skills/flow/worktree-merge.md
  - plugin/bin/hooks.js
  - plugin/bin/compose-subject.js
  - plugin/bin/log-decision.js
  - plugin/skills/_shared/scratch-worktree.md
---

# Reconcile `local-merge` Branches From Several Terminals

**Persona:** Maintainer of a no-forge (`integration-model: local-merge`) project who ran `/claude-tweaks:flow` on several records in parallel terminals and is now present, merging those finished branches into the base branch one by one.
**Goal:** Every branch that can merge does, and every branch that doesn't — skipped, aborted, or stopped by a failed check — keeps its run's worktree assignment and `active` status, so its worktree stays protected from teardown until someone comes back to it.
**Entry point:** `flow/worktree-merge.md`'s `local-merge` Merge Procedure, reached once the parallel terminals' branches are complete.
**Success state:** The Post-Merge Summary lists each branch with one status. Every `Merged…` row's run is closed. Every `Skipped`, `Not merged`, and `…re-protected` row's run shows `active` with its worktree recorded. Each `Re-protect failed` row names a run left unprotected, with the hook's output. The base branch is pushed once.

## Steps

### 1. Map each branch to its run before anything closes
- **URL:** none — the main checkout, from the reconciling terminal
- **Action:** For each branch, smallest diff first, read every non-`clean` candidate run's worktree from `{run-dir}/run-state.json` (an absolute `$RUN_ROOT/.claude-tweaks/pipelines/<id>` path) and keep the run whose worktree has `{branch}` checked out.
- **Should feel:** Like bookkeeping, not risk — nothing has changed state yet.
- **Should understand:** `close-run` nulls `run-state.json`'s `worktree`, so the path is read now, while it still exists. A branch with no matching run has nothing to protect and merges without any close or re-protect.
- **Red flags:** Any `close-run` happening before this read. A relative `{run-dir}` whose `MODULE_NOT_FOUND` silently turned into "no run matches".

### 2. Pre-merge checks pass, or stop with the run untouched
- **URL:** none — main checkout
- **Action:** The branch guard confirms the checkout is still on `{base-branch}`. Then `compose-subject.js` writes the merge message, and `git merge-tree --write-tree` predicts the merge, all without mutating anything.
- **Should feel:** Safe to fail — a stop here costs nothing.
- **Should understand:** A guard abort stops the reconciliation, then pushes the branches already merged. A composer failure, or a pre-check error with no `CONFLICT` line, leaves the branch `Not merged (pre-merge check failed: {reason}) — run still active`. A predicted conflict goes straight to the conflict menu, with the run still open.
- **Red flags:** A run showing `clean` after a check stopped its branch; the Summary labelling a pre-check error as `Skipped (conflict)`.

### 3. Close only this branch's run, then merge
- **URL:** none — main checkout
- **Action:** `hooks.js close-run --run "{run-dir}"` runs for this branch's run alone, then `git merge --no-ff {branch} -F "{subject-dir}/message.txt"`.
- **Should feel:** Targeted — other terminals' unrelated runs are never touched.
- **Should understand:** `git merge` itself is not gated by the working-directory hook. Closing just before the merge keeps the window in which a closed run has no merged branch as short as it can be.
- **Red flags:** A sweep closing every run under `.claude-tweaks/pipelines/*/`; a sibling session's run losing its worktree assignment.

### 4. Handle a conflict — resolve, skip, or abort
- **URL:** none — `AskUserQuestion` "How do you want to handle this merge conflict?"
- **Action:** The maintainer picks **Resolve now**, **Skip this branch**, or **Abort remaining merges**.
- **Should feel:** In control — each option says what it leaves behind.
- **Should understand:** **Skip** and **Abort** keep every unmerged branch's run `active` with its worktree. **Resolve now** closes this branch's run first, then commits the resolution (`git commit --no-edit --cleanup=strip` in the main checkout, which keeps git's `# Conflicts:` comments out of the merge body, or a scratch worktree plus fast-forward under `worktree-always`). If the hook still denies that commit because another branch's run in this reconciliation is newer, that run is closed too and re-protected once the resolution lands. A run outside the reconciliation is never closed: the resolution counts as abandoned, every run closed for it is re-protected, and that run is reported.
- **Red flags:** A skipped or aborted branch's run left `clean`; an abandoned or stopped resolution that never re-protected every run it closed; the reconciling session closing a run that isn't part of this reconciliation.

### 5. A failure after the close re-protects the run
- **URL:** none — main checkout
- **Action:** A branch-guard abort at the merge (the checkout moved after the close), a failed merge (aborted), a resolution abandoned or stopped before it lands, or a failed push (including no linked worktree left to push from) re-stamps each affected run with `env -u CLAUDE_CODE_SESSION_ID … record-worktree --run "{run-dir}" "{worktree-path}"`, using the path step 1 read.
- **Should feel:** Self-healing — the worktree is protected again without the maintainer chasing it.
- **Should understand:** Leaving the session id unset keeps the run's original owner. Otherwise the reconciling terminal would take over another terminal's run. Any output other than `worktree recorded` is logged to that run's `decisions.md` (the text goes through `log-decision.js --text-file`, never shell quoting) and named in the Summary. If that log call fails too, both outputs go in the Summary's `Re-protect failed` row.
- **Red flags:** A re-protected run whose `sessionId` now names the reconciling session; a re-stamp failure that never reached `decisions.md`.

### 6. Push once and read the summary
- **URL:** none — `git -C "{worktree-path}" push origin {base-branch}` from a linked worktree, then the Post-Merge Summary table
- **Action:** The base branch is pushed once, after every branch is merged or skipped. On push failure, or with no linked worktree left to push from, every run closed in this reconciliation is re-protected and the local merges are left for a human to push.
- **Should feel:** Final and legible — one row per branch, each naming whether its run is still active.
- **Should understand:** Rows `Skipped (conflict) — run still active`, `Not merged (aborted) — run still active`, `Not merged (checkout moved before the merge) — run re-protected` and `Merged locally, push failed — run re-protected` tell the maintainer which worktrees are still in play; `Re-protect failed: {output line} — run unprotected` names any that are not.
- **Red flags:** A branch missing from the table; an `active`-claiming row whose run is actually `clean`.

## Origin
- Created during build of #3809 (flow worktree-merge closed every run before the multi-run merge, leaving skipped, aborted or failed runs closed)
- Updated after #3809's review: the branch-guard abort at the merge, a stopped resolution, and a push with no worktree left now re-protect; Resolve-now commits with `--cleanup=strip`; the re-stamp log goes through `--text-file`; the Summary gained the `checkout moved before the merge` and `Re-protect failed` rows
- Related: #3762 (same close-run ordering fix on the three no-human local-merge procedures — see `finish-a-local-merge-run-without-a-human.md`)
