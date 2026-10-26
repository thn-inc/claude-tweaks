---
files:
  - plugin/skills/_shared/git-discipline.md
  - plugin/bin/pr-merge-state.js
  - plugin/bin/lib/reconcile/pr-state.js
  - plugin/skills/_shared/pr-early-run-lifecycle.md
  - plugin/skills/wrap-up/execution-and-verification.md
---

# Notice a Run's PR Gone Conflicting at a Phase Exit

**Persona:** a maintainer of a `pr-first` project running a long `/claude-tweaks:flow #N` or a `/claude-tweaks:dispatch` firing, while sibling records keep merging into the integration branch. One of them touches the same files, and the run's draft PR quietly starts to conflict.
**Goal:** find out at the first phase exit after the base moved that the PR conflicts, before test, review and the merge decision run on a tree that cannot merge. In `auto`, get the branch caught up without being asked.
**Entry point:** any phase exit's push (`build`, `test`, `review`, `polish`, `wrap-up`) of a run whose draft PR `_shared/pr-early-run-lifecycle.md` opened at run start, under `_shared/git-discipline.md`'s Phase exit section, which then runs `node "${CLAUDE_PLUGIN_ROOT}/bin/pr-merge-state.js" --run "$PIPELINE_RUN_DIR" --phase {phase}`.
**Success state:**
- A conflicting PR gets one phase-output line and one `AUTO` line in `decisions.md` naming the PR and the phase.
- In `auto`, the next phase starts on a branch merged up to the integration branch and re-pushed, so the PR's `pull_request` CI runs again.
- A clean, closed or PR-less run sees nothing new.
- A read that could not tell leaves one `SKIP` line.

## Steps

### 1. The phase-exit push lands; the PR's merge state is read once
- **URL:** `plugin/skills/_shared/git-discipline.md` "Post-push merge-state check"
- **Action:**
  - After a successful push, the phase runs `bin/pr-merge-state.js`.
  - The CLI reads `run-state.json`'s `pr.number` and calls `bin/lib/reconcile/pr-state.js`'s `resolvePrStateByNumber` once.
  - It prints one JSON line, `{state, pr, mergeable, mergeStateStatus, phase, logged, reason?}`, and exits 0.
- **Should feel:** Invisible when nothing is wrong. There is no prompt, and the phase is never slowed past one resolver call.
- **Should understand:**
  - `conflicting` means `mergeStateStatus: DIRTY` or `mergeable: CONFLICTING`.
  - `unknown` is GitHub's mergeability calculation that has not finished yet, which is common right after a push. It is never read as a conflict and never re-read, except once, later, by wrap-up's Leave-open mergeability re-check when the wrap-up exit's read came back `unknown`.
  - `not-open` is a closed or merged PR. It is no signal, whatever its mergeability says.
- **Red flags:**
  - The check runs after a failed push.
  - A second read is taken because the first one came back `UNKNOWN`, outside wrap-up's Leave-open mergeability re-check (which takes exactly one).
  - Anything is written to `run-state.json`.

### 2. A conflicting PR is named, logged, and (in auto) caught up
- **URL:** `plugin/skills/_shared/git-discipline.md` `conflicting` bullet and "Catch-up (`auto`)"
- **Action:**
  - The CLI has already appended `AUTO … Phase-exit merge-state check ({phase}): PR #{n} conflicts with the integration branch …`.
  - The phase prints "PR #{n} conflicts with `{integration-branch}` at {phase} exit — no `pull_request` CI runs until the branch is caught up".
  - In `auto` (and in `confirm`, once approved), the catch-up runs. It refuses on a dirty worktree. Otherwise it fetches, records the pre-merge HEAD, runs `merge --no-edit origin/{integration-branch}`, resolves and commits any conflict it can resolve confidently, and re-pushes with `git -C {worktree} push origin {branch}`.
- **Should feel:** Like CI noticing on the maintainer's behalf. The conflict surfaces at the build or test exit, not at the merge decision.
- **Should understand:**
  - The catch-up merges and never rebases, because the branch is already public behind its PR.
  - A conflict it cannot resolve confidently is aborted (`merge --abort`) and logged as `AUTO`. The next phase then starts on the clean, un-merged branch, and the conflict is left for the merge path at merge time. The run never stops to ask.
  - If the local merge brings in nothing, GitHub's conflict state was stale. That gets logged, and nothing is pushed.
  - `interactive` and `hybrid` only print the line and the commands. The next phase starts as it would have. The one exception is wrap-up's Leave-open mergeability re-check, which runs git's own auto-merge in every mode.
- **Red flags:**
  - A mid-flow question in `auto`.
  - The next phase starting with `MERGE_HEAD` set or with conflict markers in the tree.
  - A rebase or force push.
  - A catch-up attempted at wrap-up's exit when the merge path runs (it owns that case); only a leave-open run catches up there, per `wrap-up/execution-and-verification.md`.

### 3. Nothing to do, or nothing could be learned
- **URL:** `plugin/skills/_shared/git-discipline.md` `no-conflict`/`not-open`/`no-pr` and `unknown`/`read-failed`/`gh-absent` bullets
- **Action:**
  - `no-conflict`, `not-open` and `no-pr` write nothing.
  - `unknown`, `read-failed`, `gh-absent` and a CLI exit of 2 or 3 write one `SKIP` line (`condition: pr-merge-state.js {state} → fallback: no merge-state signal this phase`). The phase then proceeds unchanged.
- **Should feel:** Quiet. A `local-merge` or `current-branch` run never reaches the check at all.
- **Should understand:** A `SKIP` line means "no signal this phase", never "clean". The next phase exit's check reads the state again, and the merge gate's own read stays the final authority.
- **Red flags:**
  - A `local-merge` run logging anything from this check.
  - `unknown` logged as a conflict, or treated as a pass with no `SKIP` line.
  - A degraded read stopping the phase.

## Origin
- Created during `/claude-tweaks:build` of record #2986 (2026-10-19). The phase-exit push now reads the run PR's merge state through `bin/pr-merge-state.js`. A conflict is logged, and in `auto` the branch is caught up before the next phase.
- Related:
  - `docs/journeys/stop-a-run-on-its-own-red-pr-check-3013.md`: the CI-checks read at the test and review gates.
  - `docs/journeys/finish-a-local-merge-run-without-a-human.md`.
