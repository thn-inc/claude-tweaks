---
files:
  - plugin/skills/_shared/ci-skips-drafts.md
  - plugin/skills/_shared/pr-first-merge.md
  - plugin/bin/ready-run.js
  - plugin/bin/lib/pr-checks/ready-run.js
  - plugin/bin/lib/pr-checks/classify.js
  - plugin/bin/lib/merge-verification.js
  - plugin/skills/dispatch/close-out.md
  - plugin/skills/test/ci-source.md
---

# Skip CI on Draft PRs and Still Merge Only Verified Heads

**Persona:** Maintainer of a private `pr-first` repository who has noticed that every phase push to a run's draft PR runs the full `pull_request` CI and bills Actions minutes, and wants CI to run once, when the run marks its PR ready.
**Goal:** Change the CI workflow to skip drafts without the merge gate reading the draft-time skipped jobs as green and merging an unverified head.
**Entry point:** `plugin/skills/_shared/ci-skips-drafts.md`, cited from `_shared/git-discipline.md`'s per-phase push rationale and `test/ci-source.md`.
**Success state:** Draft-time pushes cost no CI minutes; after `gh pr ready` the gate waits for the run the ready event starts and merges only when that run is green; a workflow set up wrong parks with a reason that names the file and the fix.

## Steps

### 1. Adopt the workflow shape — the project's `.github/workflows/*.yml`
- **URL:** `plugin/skills/_shared/ci-skips-drafts.md` § Workflow shape
- **Action:** Set `types: [opened, synchronize, reopened, ready_for_review]` on the `pull_request` trigger and add `if: github.event.pull_request.draft == false` to the job.
- **Should feel:** Copy-paste simple — one trigger line and one job condition.
- **Should understand:** `ready_for_review` is what starts the run the gate waits for, and `synchronize` stays so a push after undraft still runs CI. The condition belongs on the job in this workflow, not inside a reusable workflow the gate never opens.
- **Red flags:** The convention telling them to drop `synchronize`; a draft condition hidden in a `uses:` workflow read as satisfied.

### 2. Decide about the `ci` verification source
- **URL:** `plugin/skills/test/ci-source.md` § CI that skips draft PRs
- **Action:** If `.claude-tweaks/verify-scope.json` declares a `ci` block, remove it, and remove a top-level `"localRuns": "on-request"` with it: verification runs locally during the pipeline, and CI runs once at ready.
- **Should feel:** A clear either/or, not a tuning puzzle.
- **Should understand:** Declaring both is a misconfiguration. With a job-level skip every verify falls back on `ci-job-skipped` after one poll; with a workflow-level gate each verify stalls for `waitSeconds`. Under `localRuns: "on-request"` neither falls back quietly: each such verify exits 3 ("no verdict yet"), and a pipeline site re-runs it once with `--local` and logs one `AUTO` line (#5370). `localRuns` is valid only beside a `ci` block, so a declaration that drops `ci` and keeps the key fails validation with an error starting `localRuns:`.
- **Red flags:** Verify stalling 15 minutes per phase with no hint that the `ci` declaration and the draft skip conflict.

### 3. Watch a run reach its merge gate — the run's PR
- **URL:** `_shared/pr-first-merge.md` Step 2.5 (the merge gate), or `dispatch/close-out.md` for a parked run's close-out
- **Action:** Let a pipeline run reach its merge. The gate runs `gh pr ready`, then reads the ready run (`bin/ready-run.js`) next to the rollup and the head runs.
- **Should feel:** Patient for the right reason — the gate waits on the CI run that matters, not on a timer.
- **Should understand:** The ready run is a `pull_request` run of that workflow file created at or after the PR's last `ReadyForReviewEvent`. Until it exists the verdict is pending (`no run since ready: {file}`), and the bounded watch keeps waiting, still capped at 15 minutes. Draft-time skipped jobs never count as a pass. A post-ready run that concluded `skipped`, `cancelled`, `action_required` or `stale` does not count either: a push made seconds before `gh pr ready` can start a run whose payload still says draft, so its jobs skip, and the gate keeps waiting for a run that verified the head. Close-out does not wait: when `dispatch/close-out.md` marks a draft PR ready, its CI re-read is pending and the candidate stops with `stopped: CI pending`; run `/claude-tweaks:dispatch close-out #{n}` again once the ready run finishes.
- **Red flags:** A merge seconds after `gh pr ready` while the ready run has not registered; the gate reading a re-run of a draft-time run as the ready run; a post-ready run whose jobs all skipped counted as the ready run; close-out reaching its merge question straight after marking the PR ready.

### 4. Fix a workflow the gate parked
- **URL:** the record's park comment (`Parked by merge-verification ({value}): … on PR #{n}. {resume}`)
- **Action:** Read the reason and fix the named workflow file.
- **Should feel:** Pointed — the comment names the file and the one-line change.
- **Should understand:** `draft-skip-without-ready-trigger:{file}` means the workflow skips drafts but has no `ready_for_review` in its types (default types included), so it will never run again on this head; add `ready_for_review` and push, or let a later push that really runs CI clear it. `checks-pending-timeout` naming `{file} unparsed` means the gate could not read that file's `on:` block and conservatively waited for a ready run; rewrite it as a plain block. `checks-pending-timeout` ending `(no run since ready: {file})` means no run of that file counted within the 15 minutes: either none started (check that its `types` include `synchronize` and `ready_for_review`), or every post-ready run skipped or was cancelled (check the job's condition). Recovery then follows `docs/journeys/recover-a-ci-parked-run.md`.
- **Red flags:** A park that names no file; an unreadable workflow treated as having no requirement and merged.

## Origin
- Created during build of #5153 (the merge gate reads checks right after `gh pr ready`, so a project whose CI skips draft PRs is read green): Steps 1-4 built in this session.
- Updated during wrap-up of #5153: step 3 now says a skipped or cancelled post-ready run does not count and that close-out stops pending instead of waiting; step 4 explains a `(no run since ready: …)` timeout.
- Step 2 updated at wrap-up of #5370: removing the `ci` block also removes `localRuns`, which is invalid without it, and under `localRuns` the misconfiguration ends each verify on exit 3 and a `--local` re-run.
- Related specs: #5152 (the generated tracking workflow's runner cost), #5154 / #5159 (CI-cost visibility), #5162 (init's CI-workflow review, which will detect the `ci`-source conflict), #4347 (CI as the verification source).
