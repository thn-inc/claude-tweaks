---
files:
  - plugin/skills/build/plan-reuse.md
  - plugin/skills/build/SKILL.md
  - plugin/skills/build/plan-review.md
  - plugin/bin/plan-store.js
---

# Build a Record Whose Plan Was Reviewed at Specify

**Persona:** A maintainer running `/claude-tweaks:flow` (or `/claude-tweaks:build`) on a record that `/claude-tweaks:specify` shaped under `plan-at-specify: on`. Its plan was written, reviewed and stored then, and they don't want the build to pay for writing and reviewing it again.
**Goal:** The build picks up the stored plan when it is still valid, skips writing a new one and skips the plan review, and falls back to planning as usual, visibly, when it is not valid.
**Entry point:** `.claude-tweaks/policy.yml` with `plan-at-specify: on`, and a `ready` record `#N` whose body carries a `Plan: refs/claude-tweaks/plans/{n} {commit} spec-sha256:{hash}` line.
**Success state:** The worktree carries the stored plan in `docs/superpowers/plans/` as its own commit, `Add the plan reviewed at specify ({commit})`. The run's `decisions.md` holds one `AUTO` reuse line and two `SKIP` lines (Spec Step 3, Common Step 1.6), and the build goes straight on to Common Step 1.5's plan audit and execution.

## Steps

### 1. Start the build — slash command
- **URL:** `/claude-tweaks:flow #N`
- **Action:** Run the pipeline as usual. Spec Step 2 finds no plan for this spec in `docs/superpowers/plans/` and is about to go to Spec Step 3.
- **Should feel:** Identical to any build up to this point. No new prompt and no new stop.
- **Should understand:** The pointer in `build/SKILL.md` reads `plugin/skills/build/plan-reuse.md` only when `resolve-policy.js --values plan-at-specify` prints `on`. With the policy off, or an older plugin build that does not know the key, nothing changes and nothing new is logged.
- **Red flags:** A reuse log line on a build with the policy off. A reuse attempt on a spec with no `Plan:` line. A new question asked here.

### 2. Watch the reuse checks — decisions.md
- **URL:** `{run-dir}/decisions.md`
- **Action:** Read the `/build` section after Spec Step 2.
- **Should feel:** Like a quick, mechanical yes or no, with no judgment call to read through.
- **Should understand:**
  - The probe reads the materialized spec's `Plan:` line (in the metadata block above the first `##` heading).
  - `plan-store.js check` then validates the ref, spec hash, base and the files the plan names against `git merge-base HEAD origin/{integration-branch}`.
  - `plan-store.js read` fetches the plan, and `plan-audit.js` audits it against the spec.
  - The spec's `ASSUMPTION — verify at build:` probes still run.
  - A record whose template changed since filing skips reuse with its own `SKIP` line, so Spec Step 3 can re-read the installed template.
- **Red flags:** A reuse that skipped `plan-audit.js`. A probe fault (an unreadable spec) logged as a reuse failure instead of stopping BLOCKED. A `Plan:` line naming another record's plan accepted.

### 3. See the plan committed — git log
- **URL:** `git log --oneline` in the worktree
- **Action:** Look for the reuse commit right after the materialize and ledger commits.
- **Should feel:** Like the plan was always part of this branch. It is one commit, with the plan commit sha in its subject.
- **Should understand:** Spec Step 3 (writing the plan) and Common Step 1.6 (plan review) do not run, and each logs `SKIP` with `condition: plan reviewed at specify ({commit})`. Common Step 1.5's plan audit still runs on the committed plan.
- **Red flags:** A second plan written beside the reused one. A Capable plan-review dispatch on the reused plan. A failed copy or commit that the build carried past instead of stopping BLOCKED.

### 4. Fall back when the plan went stale — decisions.md
- **URL:** `{run-dir}/decisions.md`
- **Action:** Build a record whose spec changed, or whose named files moved on the integration branch, after specify stored the plan.
- **Should feel:** Like an ordinary build. The only trace of the failed reuse is one log line.
- **Should understand:** A failed check logs `condition: plan-reuse failed: {reason}`, where `{reason}` is one of `ref`, `hash`, `base`, `files`, `plan-audit`, `malformed Plan line` or `premise`. The build then writes a new plan at Spec Step 3. Every `Settled at planning:` and `Decided by the user at planning:` line in the spec's `## Planning Decisions` goes into the new plan as a decided input, and a new plan that departs from one logs `planning decision departed:`.
- **Red flags:** A failed reuse that stops the build. A re-plan that silently contradicts a recorded planning decision. A reason outside the seven.

### 5. Resume after a reuse — slash command
- **URL:** `PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "#N" build`
- **Action:** Resume an interrupted build whose reused plan is already committed.
- **Should feel:** Like any resumed build (`resume-a-build-with-a-still-valid-plan-3666.md`). The committed plan is simply the existing plan.
- **Should understand:**
  - Spec Step 2's resume branch takes over, and the reuse check never runs again.
  - Common Step 1.6 is decided by the resume branch's own rule, not skipped by reuse a second time. A reuse `SKIP` is not a completed review, so the review runs.
  - A reused plan that is now stale goes to Spec Step 3 as written, with no reuse verdict. The build recognises it by its `Add the plan reviewed at specify` commit.
- **Red flags:** A second `AUTO` reuse line. A second `Add the plan reviewed at specify` commit. A resume that re-runs `plan-store.js check` on the committed plan.

## Origin

Built for record #6060 (`/build` reuses a valid specify-time plan). It reads the plan #6052 stores (`store-a-reviewed-plan-beside-its-record-6052.md`) and #6056 plans and reviews at specify (`plan-a-record-while-shaping-it-6056.md`). Its resume step runs through #3666's resume branch (`resume-a-build-with-a-still-valid-plan-3666.md`).
