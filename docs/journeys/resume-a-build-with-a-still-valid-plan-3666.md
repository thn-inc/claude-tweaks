---
files:
  - plugin/skills/build/SKILL.md
  - plugin/skills/build/plan-review.md
  - plugin/skills/build/plan-audit.md
---

# Resume a Build Whose Plan Is Still Valid

**Persona:** claude-tweaks user re-running `/claude-tweaks:build #{n}` (or `/claude-tweaks:flow #{n} build`) after an earlier build of the same record stopped part-way — a timeout, a closed terminal, a failed task — with its plan file still on the branch.
**Goal:** Pick the build back up without redoing finished work, and without skipping the checks that would catch a plan or spec that changed while the build was stopped.
**Entry point:** `/claude-tweaks:build` Spec Step 2 finding an existing plan in `docs/superpowers/plans/` and judging it still valid, with tasks left to build.
**Success state:** The build resumes at Common Step 1.5: the plan audit and design pre-build run again, the plan review runs again unless this run already completed one for an unchanged spec and plan, and execution continues from the next unbuilt task. Every skip the build takes leaves a `SKIP` line in the run's `decisions.md`.

## Steps

### 1. Re-run the build — terminal
- **URL:** the `/claude-tweaks:build` or `/claude-tweaks:flow` output after Spec Step 2
- **Action:** Re-invoke the build for the same record. Spec Step 2 finds the existing plan, compares it with the spec, and checks what is already implemented.
- **Should feel:** Like continuing, not starting over — no new plan is written and no finished task is dispatched again.
- **Should understand:** A still-valid plan resumes at Common Step 1.5, not Common Step 2. A stale plan (the spec changed, or the codebase moved under it) goes back to Spec Step 3 for a fresh plan instead.
- **Red flags:** The output jumping straight to task dispatch with no plan audit or plan-review line; a finished task being implemented a second time.

### 2. Let the plan audit re-check the plan — terminal
- **URL:** the Common Step 1.5 `plan-audit.js` summary line
- **Action:** Nothing — the audit runs under its own skip gate, the same gate a fresh build uses (a `fast-lane` record or a trivial plan still skips it, with a `SKIP` line).
- **Should feel:** Cheap and quiet — a read-only re-check of the plan against today's repo.
- **Should understand:** A Check C finding on a task the earlier run already built is expected: its `Expected: FAIL` command now passes because the task is done, so it is not a stop. A Check C finding on a task not yet built still stops the build.
- **Red flags:** The resume stopping on a Check C finding for a task whose commits are already on the branch; an unbuilt task's passing pre-run waved through as "already done".

### 3. See whether the plan review runs again — terminal
- **URL:** the Common Step 1.6 line in the build output, and the run's `decisions.md`
- **Action:** Nothing, unless the review asks a question (then answer it as in `answer-a-plan-review-question-3377.md`).
- **Should feel:** Asked once per plan, not once per session — a resume that already passed the review does not ask the same questions again.
- **Should understand:**
  - The review is skipped only when this run's `decisions.md` already records a completed review of this plan (an `AUTO` or `SCANNED` Common Step 1.6 entry) and neither the plan nor the worktree's `work/{n}-spec.md` has a commit since. That skip is logged as `SKIP` with condition `resumed build: plan already reviewed this run, spec and plan unchanged since`.
  - The review runs again when no completed review is recorded (a new run directory, or an earlier review that was unavailable) or when the spec or plan changed after it — for example a spec re-materialized from a record body someone edited.
  - Design mode has no plan review; a design-mode resume re-runs Common Steps 1.5 and 1.7 only.
- **Red flags:** A review skipped with no `SKIP` line; a review skipped although the spec was re-materialized after it; the same plan reviewed twice in one run with nothing changed in between.

### 4. Continue from the next unbuilt task — terminal
- **URL:** the Common Step 1.7 line, then the Common Step 2 dispatch output
- **Action:** Nothing — design pre-build re-runs under its own skip conditions, then execution resumes.
- **Should feel:** Seamless — the implementers get the same design references a fresh build would load.
- **Should understand:** Design pre-build re-runs because the references it loads live in implementer prompts, which a resumed session no longer holds.
- **Red flags:** A frontend record resuming with no design pre-build line and no `SKIP` explaining why.

## Origin
- Created during build of #3666 — found at #3377's final review: Spec Step 2's "skip to Common Step 2" jumped Common Steps 1.5-1.7 on every resume, including the plan review #3377 added.
- Pinned by `tests/build-resume-common-steps.test.js`.
- Related: `answer-a-plan-review-question-3377.md` (the plan review a resume may re-run).
