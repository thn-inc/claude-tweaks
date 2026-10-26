---
files:
  - plugin/skills/wrap-up/merge-mode.md
  - plugin/skills/wrap-up/SKILL.md
  - plugin/skills/wrap-up/flags.md
  - plugin/skills/_shared/pr-first-merge.md
  - plugin/skills/flow/summary-template.md
  - plugin/bin/lib/hooks/run-dir-resolve.js
  - tests/wrap-up-merge-mode-conformance.test.js
---

# Merge a Parked Unattended PR

**Persona:** a maintainer whose repo runs at `autonomy: unattended`. A `/claude-tweaks:flow` run ended with its PR parked as `pending-review`. They read the summary and say "go ahead, merge it", in the same session, while the run's context is still loaded.

**Goal:** the PR merges now, in this session. That means acceptance labeling, the merge-verification gate, worktree teardown, claim release, and archival, with no Review Console question and no hand-run merge procedure. If the PR has gone `DIRTY` since the run parked, the agent resolves the conflict when both sides' intent survives, and otherwise stops cleanly.

**Entry point:** the flow summary's Resume-to-merge row, which under `consoleAutoResolve` reads `/claude-tweaks:wrap-up {target} merge`.

**Success state:**
- The PR is squash-merged under a `human-approved` subject.
- The run's worktree is removed, after the containment proof, and its remote branch is deleted.
- The claim is released, and the run dir is archived last.

When it cannot merge, the outcome is `pending-review` with the PR ready and a stated reason, never a silent park.

## Steps

### 1. Pick the merge row from the summary
- **URL:** `flow/summary-template.md`'s Resume-to-merge row
- **Action:** read the row and run it, or tell the agent "go ahead" and let it run it.
- **Should feel:** like the recommended next step actually does the thing it names.
- **Should understand:** the row depends on the run's ceiling.
  - If `bookkeepingPermissions(ceiling).consoleAutoResolve` is true (`unattended`), the row is the merge-mode command.
  - At any other ceiling it stays `PIPELINE_RUN_DIR=… /claude-tweaks:flow "{target}" wrap-up`, which re-offers the console's merge question. Under `unattended` that resume would re-resolve the console with no question and re-park the PR.
- **Red flags:**
  - An `unattended` summary that still recommends the flow resume row.
  - The merge row rendered with the PR number in place of the record reference.

### 2. Run `/claude-tweaks:wrap-up #{n} merge`
- **URL:** `wrap-up/SKILL.md`'s Phase 1 router, then `wrap-up/merge-mode.md`
- **Action:** the command routes to merge mode, which adopts the parked run's directory.
- **Should feel:** immediate. One command, no prompts.
- **Should understand:**
  - **When it routes.** The router fires only when the arguments are nothing but `merge`, at most one record reference, and wrap-up's own tokens. Free text like "fix the merge bug" stays conversation-based work.
  - **Run adoption.** Merge mode adopts the run the way the explicit `#{n}` re-entry does. That is not `resume`: a parked run stays `status: active`.
  - **Whose run it adopts.** `resolve-run-dir --spec-slug "spec-{n}"` matches the slug as a whole `-`-delimited name segment, so `spec-378` adopts `…-spec-378` (or a multi-spec `…-spec-378-379`) and never a `…-spec-3784` neighbour's run (#3865).
  - **When nothing resolves,** it stops and names the record. It never mints a run dir.
- **Red flags:**
  - A bare `merge`, or `merge` with `cleanup-only`, `--dry-run` or `resume`, doing anything but report the tokens and stop.
  - `--dry-run` performing a real merge.
  - Merge mode for `#378` adopting a run dir whose name ends `-spec-3784` or `-spec-3784-3790` — another record's PR and claim.

### 3. Pass the preconditions
- **URL:** `merge-mode.md`'s Preconditions
- **Action:** the agent checks three things: `integration-model: pr-first`, a `pr` object in `run-state.json`, and the PR still `OPEN`.
- **Should feel:** safe to re-run. A PR a sibling already merged stops the command with no cleanup.
- **Should understand:** each failed precondition is named, and none of them runs a merge step first.
- **Red flags:** any merge, label, or teardown step on a closed or merged PR.

### 4. Merge through the shared procedure
- **URL:** `_shared/pr-first-merge.md` Steps 1-3 (acceptance labeling, curation guard, mark ready, the merge-verification gate, the merge), read through the composed `merge` bundle
- **Action:** the agent runs the same procedure every merge site uses, tagged `human-approved`.
- **Should feel:** identical to an auto-merge, except that the subject credits a human.
- **Should understand:**
  - **Acceptance labeling** runs unconditionally, because merge mode never trusts that the parked run did it.
  - **Recognized signatures.** `gh pr merge --auto` failing with "Protected branch rules not configured" is branch 1's recognized signature, and it lands on the immediate `--squash`.
  - **Other errors.** Only an unrecognized error re-reads `mergeStateStatus` before accepting `pending-review`.
- **Red flags:**
  - A `"Review Console"`-headed question.
  - A run of `console-resolve.js`.
  - A merge whose subject lacks the `human-approved` tag.

### 5. Resolve a conflict, or stop cleanly
- **URL:** `pr-first-merge.md`'s Conflict path (the attended-branch pointer), then `merge-mode.md`'s `## Conflict`
- **Action:** if the PR went `DIRTY`, the agent makes the one update-from-base merge.
  - Where both sides' intent can be kept, it resolves the conflict.
  - An `IL-{N}` collision renumbers the branch's own entry and its citations.
  - It then runs the full suite through `verify.js`, commits, pushes, and re-enters the merge-verification gate.
- **Should feel:** like a careful colleague merged main in, not like a guess.
- **Should understand:**
  - **One attempt only.** A second `DIRTY` after the push reports `pending-review` (`moving-target`).
  - **When it stops.** A conflict needing a judgment between the two intents, or a red suite, runs `git merge --abort`, leaves the PR ready, and names the files.
  - **Other callers.** Headless callers still stop at the first conflict marker.
- **Red flags:**
  - A resolution that drops one side's change.
  - A renumbered integration-branch incident entry.
  - A merge after a red suite.
  - A second conflict round.

### 6. Read the outcome and the cleanup
- **URL:** the closing report (`merged`, `armed`, or `pending-review`) and `{run-dir}/decisions.md`
- **Action:** on `merged`, the agent works through the cleanup in this order:
  1. Release-carrier tracking (Step 4.1).
  2. The worktree teardown, which covers close-run, the containment proof, `ExitWorktree`, and the remote-ref delete.
  3. The claim release.
  4. Step 4.2's reconcile, last.
- **Should feel:** finished. Nothing is left for a later session to tidy.
- **Should understand:** the reconcile runs last because its archive check moves the run dir, and a `decisions.md` line written after it would recreate it.
- **Red flags:** a run dir re-created under `.claude-tweaks/pipelines/` after archival, or a worktree removed without the containment proof.

## Origin
- Created during build of #3784. The record adds `wrap-up/merge-mode.md` and the `merge` routing token, an attended Conflict-path branch, and the `consoleAutoResolve` summary row. It was observed on #3712's run (PR #3749): the summary recommended a resume that would have re-parked the PR, and the human's "go ahead" had to be honored by running the merge procedure by hand.
- Updated during build of #3865: Step 2's run adoption now matches the record's spec slug as a whole name segment, not a substring, so a record never adopts a run belonging to another record whose number starts with the same digits.
