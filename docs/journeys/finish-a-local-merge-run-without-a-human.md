---
files:
  - plugin/skills/_shared/local-merge-auto-finish.md
  - plugin/bin/compose-subject.js
  - plugin/bin/lib/commit-scope.js
  - plugin/skills/wrap-up/cleanup-procedures-execution.md
  - plugin/skills/wrap-up/review-console.md
  - plugin/skills/_shared/integration-model.md
  - plugin/skills/_shared/integration-branch.md
---

# Finish a `local-merge` Run Without a Human

**Persona:** Maintainer of a no-forge (`local-merge`) project running `/claude-tweaks:flow` in `auto`, `confirm`, or `hybrid` mode who isn't present when the run reaches its branch-finish step.
**Goal:** The run's feature branch merges itself (or parks cleanly) without ever blocking on `/superpowers:finishing-a-development-branch`'s interactive menu — the same hands-off guarantee `pr-first` runs already have via `_shared/pr-first-merge.md`.
**Entry point:** `/claude-tweaks:wrap-up`'s Phase 4 execution step, Section C (`cleanup-procedures-execution.md`), the `integration-model: local-merge` branch, once the feature branch's finish decision is "not yet decided."
**Success state:** The branch is merged into the integration branch and pushed, with the outcome logged to `decisions.md` — or, if the merge genuinely can't complete cleanly, the run parks with the worktree and branch preserved and a clear log entry explaining why, ready for a human to pick up later.

## Steps

### 1. Reach Section C with the branch not yet finished
- **URL:** none — this happens inside `/claude-tweaks:wrap-up`'s Phase 4 execution step, unattended
- **Action:** The pipeline reaches the worktree/branch-finish cleanup item having neither merged, opened a PR, nor discarded the feature branch yet.
- **Should feel:** Invisible — nothing prompts the maintainer.
- **Should understand:** This step checks `_shared/local-merge-auto-finish.md`'s Precondition first (`integration-model` resolves `local-merge` AND this run's `config.yml` exists) before deciding whether to route through the no-prompt path or the original interactive skill.
- **Red flags:** An interactive `AskUserQuestion`-shaped menu appearing here for a run whose `config.yml` exists — that would mean the precondition check was skipped.

### 2a. The branch merges itself — terminal, no interaction
- **URL:** none — `_shared/local-merge-auto-finish.md`'s Procedure runs from inside the worktree/main checkout
- **Action:** The default policy (merge locally) resolves the integration branch and reads the run's worktree from `run-state.json`, then runs every check that can fail without touching the tree — the branch guard, `bin/compose-subject.js` for the merge message (`--tag auto-finish --range {base-branch}...{feature-branch}`), and a `git merge-tree --write-tree` conflict pre-check — before `hooks.js close-run` clears the worktree assignment. Only then does it merge the feature branch with `--no-ff -F "{subject-dir}/message.txt"`, run verification on the merged result, and — on green — push and log the `merged` outcome.
- **Should feel:** Invisible — the maintainer notices only that the branch is already merged when they check back.
- **Should understand:** Discard and keep-as-is are never chosen automatically — merging locally is the only default this path can produce, matching `finishing-a-development-branch`'s own rule that discard requires an explicit human ask. The merge commit's subject is Conventional-Commits shaped (`feat|fix|chore[(scope)][!]: {title} (#N)`, #2251) and its body carries the `Fixes #N` line plus an `[auto-finish]` paragraph, so the record still auto-closes and `/help`'s auto-merged metric still counts it. The `(scope)` is present only when the project sets the `commit-scope` or `commit-scope-paths` policy key — the composer resolves it from the `--range` diff's changed paths (#3298).
- **Red flags:** A merge commit with no corresponding `AUTO … [outcome: merged]` line in `decisions.md`; a merge commit whose subject is not `{type}[(scope)]: {title} (#N)`-shaped or whose body lacks `Fixes #N`; a composer failure (a malformed `commit-scope-paths` entry, a failed `--range` diff) that merged anyway instead of parking; `close-run` running before the guard, composer, or conflict pre-check.

### 2b. The merge can't complete cleanly — parks instead
- **URL:** none — the Park branch inside `_shared/local-merge-auto-finish.md`'s Procedure
- **Action:** A branch-guard mismatch, a composer failure, or a conflict `git merge-tree` predicts parks before `close-run` runs, so the run's `worktree` and `status` are untouched. A failure that can only show up after `close-run` (a guard race, a merge `merge-tree` didn't predict, a failed verification or push) re-stamps the run with `hooks.js record-worktree --run`, restoring its worktree assignment and `active` status. A guard race or failed merge aborts the merge and a red verification resets it, but a failed push keeps the local merge commit and logs it as unpushed, so a human resuming the run can push it. Either way it logs an `AUTO … [outcome: pending-review]` line naming the reason, and the worktree, branch, and issue claim are left as they were.
- **Should feel:** A clear stop, not a silent failure — the next session picking this up sees precisely why it parked, and finds the run still assigned to its worktree.
- **Should understand:** This is the one decision `_shared/auto-mode-contract.md` reserves for a human — conflict resolution is never attempted automatically, regardless of mode. A `CONFLICT` line from the pre-check is a predicted conflict; a stderr error with none (git older than 2.38, an unknown ref) is logged as `pre-check failed`.
- **Red flags:** A worktree left half-merged; a park with no log entry naming the reason; a parked run whose `run-state.json` has no `worktree` (the reconciler could then treat a run that still needs a human as finished); a failed push that undid the local merge commit or retried the push automatically.

### 3. Interactive mode is unaffected
- **URL:** `/superpowers:finishing-a-development-branch`'s own menu, reached only when `local-merge-auto-finish.md`'s Precondition fails
- **Action:** A standalone or `interactive`-mode run (no `config.yml` in its run directory) still gets the original interactive menu and waits for an answer, exactly as before this journey's underlying behavior existed.
- **Should feel:** No change from prior behavior for anyone who runs the pipeline interactively.
- **Should understand:** The presence of `config.yml` is the same "not `interactive`" signal `wrap-up/SKILL.md`'s `ceremony-profile` read already uses — no new mode-detection mechanism was introduced.
- **Red flags:** An interactive run's menu being silently skipped — that would mean the precondition check inverted.

## Origin
- Created during build of #771 (local-merge + auto mode: finishing-a-development-branch has no auto-mode awareness, blocks on a human answer)
- Updated during wrap-up of #3298 (merge-subject scope source): step 2a's composer call carries `--range`, and the subject grammar gained the optional policy-resolved `(scope)`
- Related: #688, #689, #693 (the `pr-first` sibling behavior this journey mirrors)
- Updated during build of #3522 (guard-safe --out-dir merge fences): the composed message is read from `{subject-dir}/message.txt` via `git merge -F`, not an `eval`d `-m`
- Updated during build of #3762 (close-run ordering): the guard, composer and `git merge-tree` conflict pre-check run before `close-run`, and a park after `close-run` re-stamps the run via `record-worktree`
